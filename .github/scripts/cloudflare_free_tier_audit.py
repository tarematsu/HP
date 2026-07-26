"""Account-wide Cloudflare included-usage audit and daily projection."""

from __future__ import annotations

import datetime as dt
import glob
import json
import math
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def csv_env(name: str, default: str = "") -> tuple[str, ...]:
    return tuple(value.strip() for value in os.environ.get(name, default).split(",") if value.strip())


API = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
WORKER = os.environ.get("CLOUDFLARE_RUNTIME_WORKER", "sh-runtime-orchestrator").strip()
CONFIGS = csv_env("CLOUDFLARE_CONFIG_GLOBS")
EXTRA_BUCKETS = csv_env("CLOUDFLARE_STORAGE_BUCKETS")
KV_BINDINGS = csv_env("CLOUDFLARE_KV_BINDINGS")
DO_BINDINGS = csv_env("CLOUDFLARE_DO_BINDINGS", "BUDDIES_COLLECTOR_COORDINATOR")
OUT = Path(os.environ.get("FREE_TIER_USAGE_OUTPUT_DIR", "free-tier-usage"))
GB = 1_000_000_000

LIMITS = {
    "queueOperations": 10_000,
    "doRequests": 100_000,
    "doActiveGbSeconds": 13_000.0,
    "doRowsRead": 5_000_000,
    "doRowsWritten": 100_000,
    "doStoredBytes": 5 * GB,
    "r2ClassAOperations": 1_000_000,
    "r2ClassBOperations": 10_000_000,
    "r2StoredBytes": 10 * GB,
    "kvReads": 100_000,
    "kvWrites": 1_000,
    "kvDeletes": 1_000,
    "kvLists": 1_000,
    "kvStoredBytes": 1_000_000_000,
}
R2_CLASS_A = frozenset(value.lower() for value in (
    "ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject",
    "CompleteMultipartUpload", "CreateMultipartUpload", "LifecycleStorageTierTransition",
    "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts",
    "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration",
))
R2_CLASS_B = frozenset(value.lower() for value in (
    "HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption",
    "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration",
))
_ACCOUNT_SCOPE = "account"
_DAY_SECONDS = 24 * 60 * 60
_PROJECTION_METHOD = "linear-from-utc-midnight"
_DAILY_RATE_METRICS = (
    "queueOperations", "doRequests", "doActiveGbSeconds", "doRowsRead",
    "doRowsWritten", "kvReads", "kvWrites", "kvDeletes", "kvLists",
)
_MONTHLY_OR_STATE_METRICS = tuple(key for key in LIMITS if key not in _DAILY_RATE_METRICS)


def api(payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{API}/graphql",
        data=json.dumps(payload, separators=(",", ":")).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "github-actions-cloudflare-free-tier-budget",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1200]
        raise RuntimeError(f"Cloudflare HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Cloudflare request failed: {error.reason}") from error
    if body.get("success") is False or body.get("errors"):
        raise RuntimeError(f"Cloudflare API error: {json.dumps(body.get('errors'))[:1200]}")
    return body


def configured_resources() -> tuple[set[str], set[str]]:
    queues: set[str] = set()
    buckets = set(EXTRA_BUCKETS)
    files = 0
    for pattern in CONFIGS:
        for name in glob.glob(pattern, recursive=True):
            path = Path(name)
            if not path.is_file():
                continue
            files += 1
            config = json.loads(path.read_text(encoding="utf-8"))
            queue_config = config.get("queues") or {}
            consumers = queue_config.get("consumers") or []
            queues.update(str(row["queue"]) for row in consumers if row.get("queue"))
            queues.update(str(row["dead_letter_queue"]) for row in consumers if row.get("dead_letter_queue"))
            queues.update(str(row["queue"]) for row in queue_config.get("producers") or [] if row.get("queue"))
            buckets.update(str(row["bucket_name"]) for row in config.get("r2_buckets") or [] if row.get("bucket_name"))
    if not files or not queues or not buckets:
        raise RuntimeError("CLOUDFLARE_CONFIG_GLOBS did not resolve repository Queue and R2 resources")
    return queues, buckets


def graphql_document() -> str:
    return """query FreeTierBudget($account: string, $day: Date!, $now: Time!, $monthStart: Time!) {
      viewer { accounts(filter: {accountTag: $account}) {
        queues: queueMessageOperationsAdaptiveGroups(limit: 10000, filter: {date_geq: $day, date_leq: $day}) {
          sum { billableOperations }
        }
        r2ops: r2OperationsAdaptiveGroups(limit: 10000, filter: {datetime_geq: $monthStart, datetime_leq: $now}) {
          sum { requests } dimensions { actionType }
        }
        r2storage: r2StorageAdaptiveGroups(limit: 10000, filter: {datetime_geq: $monthStart, datetime_leq: $now}, orderBy: [datetime_DESC]) {
          max { payloadSize metadataSize } dimensions { datetime }
        }
        doInvocations: durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: {date_geq: $day, date_leq: $day}) {
          sum { requests }
        }
        doPeriodic: durableObjectsPeriodicGroups(limit: 10000, filter: {date_geq: $day, date_leq: $day}) {
          sum { duration rowsRead rowsWritten }
        }
        doStorage: durableObjectsStorageGroups(limit: 10000, filter: {date_geq: $day, date_leq: $day}) {
          max { storedBytes }
        }
        kvOperations: kvOperationsAdaptiveGroups(limit: 10000, filter: {date_geq: $day, date_leq: $day}) {
          sum { requests } dimensions { actionType }
        }
        kvStorage: kvStorageAdaptiveGroups(limit: 10000, filter: {date_geq: $day, date_leq: $day}, orderBy: [date_DESC]) {
          max { keyCount byteCount } dimensions { date }
        }
      }}
    }"""


def metric(value: Any) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, parsed) if math.isfinite(parsed) else 0.0


def count(value: Any) -> int:
    return int(metric(value))


def latest_size(groups: Any, time_key: str, *size_keys: str) -> int:
    latest = ("", 0)
    for group in groups or []:
        observed_at = str((group.get("dimensions") or {}).get(time_key) or "")
        maximum = group.get("max") or {}
        candidate = (observed_at, sum(count(maximum.get(key)) for key in size_keys))
        if candidate[0] >= latest[0]:
            latest = candidate
    return latest[1]


def _durable_object_duration_gb_seconds(groups: Any) -> float:
    duration = active_microseconds = 0.0
    has_duration = False
    for group in groups or []:
        sums = group.get("sum") or {}
        if "duration" in sums:
            has_duration = True
            duration += metric(sums.get("duration"))
        else:
            active_microseconds += metric(sums.get("activeTime"))
    return round(duration if has_duration else active_microseconds / 1_000_000 * 0.128, 3)


def aggregate(row: dict[str, Any]) -> dict[str, Any]:
    usage: dict[str, Any] = {key: 0 for key in LIMITS}
    usage["queueOperations"] = sum(
        count((group.get("sum") or {}).get("billableOperations"))
        for group in row.get("queues") or []
    )

    unknown_r2: set[str] = set()
    for group in row.get("r2ops") or []:
        action = str((group.get("dimensions") or {}).get("actionType") or "").lower()
        requests = count((group.get("sum") or {}).get("requests"))
        if action in R2_CLASS_B:
            usage["r2ClassBOperations"] += requests
        else:
            usage["r2ClassAOperations"] += requests
            if action and action not in R2_CLASS_A:
                unknown_r2.add(action)
    usage["r2StoredBytes"] = latest_size(row.get("r2storage"), "datetime", "payloadSize", "metadataSize")

    usage["doRequests"] = sum(
        count((group.get("sum") or {}).get("requests"))
        for group in row.get("doInvocations") or []
    )
    usage["doActiveGbSeconds"] = _durable_object_duration_gb_seconds(row.get("doPeriodic"))
    for group in row.get("doPeriodic") or []:
        sums = group.get("sum") or {}
        usage["doRowsRead"] += count(sums.get("rowsRead"))
        usage["doRowsWritten"] += count(sums.get("rowsWritten"))
    usage["doStoredBytes"] = max(
        (count((group.get("max") or {}).get("storedBytes")) for group in row.get("doStorage") or []),
        default=0,
    )

    operation_keys = {"read": "kvReads", "write": "kvWrites", "delete": "kvDeletes", "list": "kvLists"}
    for group in row.get("kvOperations") or []:
        action = str((group.get("dimensions") or {}).get("actionType") or "").lower()
        if key := operation_keys.get(action):
            usage[key] += count((group.get("sum") or {}).get("requests"))
    usage["kvStoredBytes"] = latest_size(row.get("kvStorage"), "date", "byteCount")
    usage["unknownR2ActionsChargedAsClassA"] = sorted(unknown_r2)
    return usage


def projection_metadata(now: dt.datetime) -> dict[str, Any]:
    elapsed = int((now - now.replace(hour=0, minute=0, second=0, microsecond=0)).total_seconds())
    elapsed = max(1, min(_DAY_SECONDS, elapsed))
    return {
        "method": _PROJECTION_METHOD,
        "periodSeconds": _DAY_SECONDS,
        "elapsedSeconds": elapsed,
        "factor": _DAY_SECONDS / elapsed,
        "projectedMetrics": list(_DAILY_RATE_METRICS),
    }


def project_daily_allowances(actual: dict[str, Any], projection: dict[str, Any]) -> dict[str, Any]:
    projected = dict(actual)
    factor = float(projection["factor"])
    for key in _DAILY_RATE_METRICS:
        value = metric(actual.get(key)) * factor
        projected[key] = round(value, 3) if key == "doActiveGbSeconds" else math.ceil(value)
    return projected


def evaluate(usage: dict[str, Any]) -> list[str]:
    return [key for key, limit in LIMITS.items() if float(usage[key]) >= float(limit)]


def usage_basis(key: str) -> str:
    if key in _DAILY_RATE_METRICS:
        return "24h projection"
    return "month-to-date" if key in {"r2ClassAOperations", "r2ClassBOperations"} else "observed state"


def self_test() -> int:
    document = graphql_document()
    for resource_identifier in ("namespaceId", "queueId", "bucketName"):
        assert resource_identifier not in document
    assert "pipelineId" not in document and "activeTime" not in document
    assert "sum { duration rowsRead rowsWritten }" in document

    actual = aggregate({
        "queues": [{"sum": {"billableOperations": 30}}],
        "r2ops": [
            {"dimensions": {"actionType": "PutObject"}, "sum": {"requests": 2}},
            {"dimensions": {"actionType": "GetObject"}, "sum": {"requests": 5}},
        ],
        "r2storage": [{"dimensions": {"datetime": "2026-07-23T00:00:00Z"}, "max": {"payloadSize": 100, "metadataSize": 5}}],
        "doInvocations": [{"sum": {"requests": 10}}],
        "doPeriodic": [{"sum": {"duration": 2.5, "rowsRead": 2, "rowsWritten": 1}}],
        "doStorage": [{"max": {"storedBytes": 50}}],
        "kvOperations": [
            {"dimensions": {"actionType": "read"}, "sum": {"requests": 7}},
            {"dimensions": {"actionType": "write"}, "sum": {"requests": 1}},
        ],
        "kvStorage": [{"dimensions": {"date": "2026-07-23"}, "max": {"byteCount": 200}}],
    })
    projection = projection_metadata(dt.datetime(2026, 7, 23, 6, 0, tzinfo=dt.timezone.utc))
    projected = project_daily_allowances(actual, projection)
    assert projection["factor"] == 4
    assert projected["queueOperations"] == 120 and projected["doRequests"] == 40
    assert projected["doActiveGbSeconds"] == 10.0
    assert projected["doRowsRead"] == 8 and projected["doRowsWritten"] == 4
    assert projected["kvReads"] == 28 and projected["kvWrites"] == 4
    for key in _MONTHLY_OR_STATE_METRICS:
        assert projected[key] == actual[key], key
    assert actual["r2ClassAOperations"] == 2 and actual["r2ClassBOperations"] == 5
    assert actual["r2StoredBytes"] == 105 and actual["doStoredBytes"] == 50
    assert actual["kvStoredBytes"] == 200 and evaluate(actual) == []
    assert _durable_object_duration_gb_seconds([{"sum": {"activeTime": 1_000_000}}]) == 0.128
    print("account-wide discovery-free audit self-test passed")
    return 0


def main() -> int:
    if not all((TOKEN, ACCOUNT, CONFIGS, WORKER, KV_BINDINGS, DO_BINDINGS)):
        raise RuntimeError(
            "Cloudflare token, resolved account ID, runtime Worker, config globs, and KV/DO bindings are required"
        )

    queue_names, buckets = configured_resources()
    now = dt.datetime.now(dt.timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    body = api({
        "query": graphql_document(),
        "variables": {
            "account": ACCOUNT,
            "day": day_start.date().isoformat(),
            "now": now.isoformat().replace("+00:00", "Z"),
            "monthStart": day_start.replace(day=1).isoformat().replace("+00:00", "Z"),
        },
    })
    accounts = (((body.get("data") or {}).get("viewer") or {}).get("accounts") or [])
    if len(accounts) != 1:
        raise RuntimeError(f"Expected one GraphQL account row, got {len(accounts)}")

    actual = aggregate(accounts[0])
    projection = projection_metadata(now)
    usage = project_daily_allowances(actual, projection)
    violations = evaluate(usage)
    report = {
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "worker": WORKER,
        "scope": _ACCOUNT_SCOPE,
        "usageKind": "mixed-daily-projection-and-period-actual",
        "actualUsage": actual,
        "usage": usage,
        "projection": projection,
        "resourceCounts": {
            "queues": len(queue_names),
            "durableObjectNamespaces": len(DO_BINDINGS),
            "r2Buckets": len(buckets),
            "kvNamespaces": len(KV_BINDINGS),
        },
        "limits": LIMITS,
        "violations": violations,
        "policy": (
            "Account-wide usage capped at 100% of Cloudflare free/no-charge allowances; "
            "daily operation meters are linearly projected from UTC midnight while "
            "monthly and stored-state meters remain unprojected"
        ),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "free-tier-usage.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    lines = [
        "## Account-wide Cloudflare free-tier 100% budgets",
        "",
        f"- Generated: `{report['generatedAt']}`",
        f"- Elapsed UTC day: `{projection['elapsedSeconds']:,}` seconds",
        f"- Daily 24-hour projection factor: `{projection['factor']:.3g}x`",
        "- Daily meters: projected from 00:00 UTC to 24 hours",
        "- Monthly and storage meters: unprojected observed values",
        "",
        "| Metric | Actual to date | Budget value | Basis | Limit | Status |",
        "|---|---:|---:|---|---:|---|",
    ]
    for key, limit in LIMITS.items():
        lines.append(
            f"| {key} | {actual[key]:,} | {usage[key]:,} | {usage_basis(key)} | "
            f"{limit:,} | {'VIOLATION' if key in violations else 'OK'} |"
        )
    summary = "\n".join(lines) + "\n"
    (OUT / "summary.md").write_text(summary, encoding="utf-8")
    if path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(path, "a", encoding="utf-8") as output:
            output.write(summary)

    print("FREE_TIER_USAGE=" + json.dumps(report, separators=(",", ":")))
    for key in violations:
        print(
            f"::error title=Cloudflare free-tier budget exceeded::{key} "
            f"actual={actual[key]} budgetValue={usage[key]} "
            f"basis={usage_basis(key)} limit={LIMITS[key]}"
        )
    return 1 if violations else 0
