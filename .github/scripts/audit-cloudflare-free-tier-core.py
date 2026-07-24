#!/usr/bin/env python3
"""Shared primitives for the account-wide Cloudflare included-usage audit."""

from __future__ import annotations

import glob
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

API = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
WORKER = os.environ.get("CLOUDFLARE_RUNTIME_WORKER", "sh-runtime-orchestrator").strip()
CONFIGS = tuple(x.strip() for x in os.environ.get("CLOUDFLARE_CONFIG_GLOBS", "").split(",") if x.strip())
EXTRA_BUCKETS = tuple(x.strip() for x in os.environ.get("CLOUDFLARE_STORAGE_BUCKETS", "").split(",") if x.strip())
KV_BINDINGS = tuple(x.strip() for x in os.environ.get("CLOUDFLARE_KV_BINDINGS", "").split(",") if x.strip())
DO_BINDINGS = tuple(x.strip() for x in os.environ.get("CLOUDFLARE_DO_BINDINGS", "RUNTIME_COORDINATOR").split(",") if x.strip())
OUT = Path(os.environ.get("FREE_TIER_USAGE_OUTPUT_DIR", "free-tier-usage"))
GB = 1_000_000_000

LIMITS = {
    "queueOperations": 8_000,
    "doRequests": 80_000,
    "doActiveGbSeconds": 10_400.0,
    "doRowsRead": 4_000_000,
    "doRowsWritten": 80_000,
    "doStoredBytes": 4 * GB,
    "r2ClassAOperations": 800_000,
    "r2ClassBOperations": 8_000_000,
    "r2StoredBytes": 8 * GB,
    "kvReads": 80_000,
    "kvWrites": 800,
    "kvDeletes": 800,
    "kvLists": 800,
    "kvStoredBytes": 800_000_000,
}

R2_CLASS_A = frozenset(x.lower() for x in (
    "ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject",
    "CompleteMultipartUpload", "CreateMultipartUpload", "LifecycleStorageTierTransition",
    "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts",
    "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration",
))
R2_CLASS_B = frozenset(x.lower() for x in (
    "HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption",
    "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration",
))


def api(url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=None if payload is None else json.dumps(payload, separators=(",", ":")).encode(),
        method="POST" if payload is not None else "GET",
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


def account_id() -> str:
    if ACCOUNT:
        return ACCOUNT
    rows = api(f"{API}/accounts?per_page=50").get("result") or []
    if len(rows) != 1:
        raise RuntimeError(f"Expected one Cloudflare account, got {len(rows)}")
    return str(rows[0]["id"])


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
            producers = queue_config.get("producers") or []
            queues.update(str(row["queue"]) for row in consumers if row.get("queue"))
            queues.update(str(row["dead_letter_queue"]) for row in consumers if row.get("dead_letter_queue"))
            queues.update(str(row["queue"]) for row in producers if row.get("queue"))
            buckets.update(str(row["bucket_name"]) for row in config.get("r2_buckets") or [] if row.get("bucket_name"))
    if not files or not queues or not buckets:
        raise RuntimeError("CLOUDFLARE_CONFIG_GLOBS did not resolve repository Queue and R2 resources")
    return queues, buckets


def number(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0


def aggregate(
    row: dict[str, Any],
    queue_ids: set[str],
    namespace_ids: set[str],
    buckets: set[str],
    kv_ids: set[str],
) -> dict[str, Any]:
    usage: dict[str, Any] = {key: 0 for key in LIMITS}
    for group in row.get("queues") or []:
        if str((group.get("dimensions") or {}).get("queueId")) in queue_ids:
            usage["queueOperations"] += number((group.get("sum") or {}).get("billableOperations"))

    unknown_r2: set[str] = set()
    for group in row.get("r2ops") or []:
        dimensions = group.get("dimensions") or {}
        if str(dimensions.get("bucketName")) not in buckets:
            continue
        action = str(dimensions.get("actionType") or "").lower()
        requests = number((group.get("sum") or {}).get("requests"))
        if action in R2_CLASS_B:
            usage["r2ClassBOperations"] += requests
        else:
            usage["r2ClassAOperations"] += requests
            if action and action not in R2_CLASS_A:
                unknown_r2.add(action)

    latest_storage: dict[str, tuple[str, int]] = {}
    for group in row.get("r2storage") or []:
        dimensions = group.get("dimensions") or {}
        bucket = str(dimensions.get("bucketName") or "")
        if bucket not in buckets:
            continue
        timestamp = str(dimensions.get("datetime") or "")
        maximum = group.get("max") or {}
        size = number(maximum.get("payloadSize")) + number(maximum.get("metadataSize"))
        if bucket not in latest_storage or timestamp > latest_storage[bucket][0]:
            latest_storage[bucket] = (timestamp, size)
    usage["r2StoredBytes"] = sum(value[1] for value in latest_storage.values())

    for group in row.get("doInvocations") or []:
        if str((group.get("dimensions") or {}).get("namespaceId")) in namespace_ids:
            usage["doRequests"] += number((group.get("sum") or {}).get("requests"))
    active_ms = 0
    for group in row.get("doPeriodic") or []:
        if str((group.get("dimensions") or {}).get("namespaceId")) not in namespace_ids:
            continue
        sums = group.get("sum") or {}
        active_ms += number(sums.get("activeTime"))
        usage["doRowsRead"] += number(sums.get("rowsRead"))
        usage["doRowsWritten"] += number(sums.get("rowsWritten"))
    usage["doActiveGbSeconds"] = round(active_ms / 1000 * 0.128, 3)
    for group in row.get("doStorage") or []:
        if str((group.get("dimensions") or {}).get("namespaceId")) in namespace_ids:
            usage["doStoredBytes"] = max(
                usage["doStoredBytes"],
                number((group.get("max") or {}).get("storedBytes")),
            )

    kv_key = {"read": "kvReads", "write": "kvWrites", "delete": "kvDeletes", "list": "kvLists"}
    for group in row.get("kvOperations") or []:
        dimensions = group.get("dimensions") or {}
        if str(dimensions.get("namespaceId")) not in kv_ids:
            continue
        key = kv_key.get(str(dimensions.get("actionType") or "").lower())
        if key:
            usage[key] += number((group.get("sum") or {}).get("requests"))
    latest_kv: dict[str, tuple[str, int]] = {}
    for group in row.get("kvStorage") or []:
        dimensions = group.get("dimensions") or {}
        namespace = str(dimensions.get("namespaceId") or "")
        if namespace not in kv_ids:
            continue
        date = str(dimensions.get("date") or "")
        size = number((group.get("max") or {}).get("byteCount"))
        if namespace not in latest_kv or date > latest_kv[namespace][0]:
            latest_kv[namespace] = (date, size)
    usage["kvStoredBytes"] = sum(item[1] for item in latest_kv.values())
    usage["unknownR2ActionsChargedAsClassA"] = sorted(unknown_r2)
    return usage


def evaluate(usage: dict[str, Any]) -> list[str]:
    return [key for key, limit in LIMITS.items() if float(usage[key]) >= float(limit)]


def self_test() -> int:
    usage = aggregate({
        "queues": [{"dimensions": {"queueId": "q"}, "sum": {"billableOperations": 30}}],
        "r2ops": [
            {"dimensions": {"bucketName": "b", "actionType": "PutObject"}, "sum": {"requests": 2}},
            {"dimensions": {"bucketName": "b", "actionType": "GetObject"}, "sum": {"requests": 5}},
        ],
        "r2storage": [{
            "dimensions": {"bucketName": "b", "datetime": "2026-01-01T00:00:00Z"},
            "max": {"payloadSize": 100, "metadataSize": 5},
        }],
        "doInvocations": [{"dimensions": {"namespaceId": "d"}, "sum": {"requests": 10}}],
        "doPeriodic": [{
            "dimensions": {"namespaceId": "d"},
            "sum": {"activeTime": 1000, "rowsRead": 0, "rowsWritten": 0},
        }],
        "doStorage": [{"dimensions": {"namespaceId": "d"}, "max": {"storedBytes": 0}}],
        "kvOperations": [
            {"dimensions": {"namespaceId": "k", "actionType": "read"}, "sum": {"requests": 7}},
            {"dimensions": {"namespaceId": "k", "actionType": "write"}, "sum": {"requests": 1}},
        ],
        "kvStorage": [{
            "dimensions": {"namespaceId": "k", "date": "2026-01-01"},
            "max": {"byteCount": 200},
        }],
    }, {"q"}, {"d"}, {"b"}, {"k"})
    assert usage["queueOperations"] == 30
    assert usage["r2ClassAOperations"] == 2 and usage["r2ClassBOperations"] == 5
    assert usage["r2StoredBytes"] == 105 and usage["doRequests"] == 10
    assert usage["doActiveGbSeconds"] == 0.128 and evaluate(usage) == []
    assert usage["kvReads"] == 7 and usage["kvWrites"] == 1
    assert usage["kvStoredBytes"] == 200
    assert LIMITS["queueOperations"] == 8_000 and LIMITS["doRequests"] == 80_000
    return 0
