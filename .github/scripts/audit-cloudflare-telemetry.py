#!/usr/bin/env python3
"""Audit current Cloudflare Worker versions with persisted and live telemetry."""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

API_BASE = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
WORKERS = tuple(value.strip() for value in os.environ.get("CLOUDFLARE_WORKERS", "").split(",") if value.strip())
LOOKBACK_MINUTES = max(1, int(os.environ.get("LOOKBACK_MINUTES", "60")))
STATELESS_CPU_BUDGET_MS = float(os.environ.get("CPU_BUDGET_MS", "10"))
QUEUE_CPU_BUDGET_MS = float(os.environ.get("QUEUE_CPU_BUDGET_MS", "30000"))
DURABLE_OBJECT_CPU_BUDGET_MS = float(os.environ.get("DURABLE_OBJECT_CPU_BUDGET_MS", "30000"))
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
LIVE_TAIL_LOG = Path(os.environ.get("LIVE_TAIL_LOG", "live-tail.log"))
EXEMPT_MARKERS = tuple(
    value.strip().lower()
    for value in os.environ.get("CPU_BUDGET_EXEMPT_MARKERS", "").split(",")
    if value.strip()
)
PAGE_SIZE = 2000
MAX_PAGES = 10
OK_OUTCOMES = {"", "ok", "canceled", "cancelled", "success"}


def request_json(url: str, *, method: str = "GET", payload: dict[str, Any] | None = None) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=None if payload is None else json.dumps(payload, separators=(",", ":")).encode(),
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "github-actions-cloudflare-observability",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"Cloudflare API HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Cloudflare API request failed: {error.reason}") from error
    if data.get("success") is False or data.get("errors"):
        raise RuntimeError(f"Cloudflare API error: {json.dumps(data.get('errors'), ensure_ascii=False)[:2000]}")
    return data


def service_filter() -> dict[str, Any]:
    return {
        "kind": "group",
        "filterCombination": "or",
        "filters": [
            {
                "kind": "filter",
                "key": "$metadata.service",
                "operation": "eq",
                "type": "string",
                "value": worker,
            }
            for worker in WORKERS
        ],
    }


def query_events(account: str, start_ms: int, end_ms: int) -> tuple[list[dict[str, Any]], int | None, bool]:
    payload: dict[str, Any] = {
        "queryId": "github-actions-current-worker-audit",
        "dry": True,
        "timeframe": {"from": start_ms, "to": end_ms},
        "view": "events",
        "limit": PAGE_SIZE,
        "offsetDirection": "next",
        "parameters": {
            "view": "events",
            "limit": PAGE_SIZE,
            "datasets": [],
            "filterCombination": "and",
            "filters": [
                service_filter(),
                {
                    "kind": "filter",
                    "key": "$workers.cpuTimeMs",
                    "operation": "exists",
                    "type": "number",
                },
            ],
        },
    }
    endpoint = f"{API_BASE}/accounts/{account}/workers/observability/telemetry/query"
    events: list[dict[str, Any]] = []
    seen: set[str] = set()
    total: int | None = None
    exhausted = False
    for _ in range(MAX_PAGES):
        result = request_json(endpoint, method="POST", payload=payload).get("result") or {}
        block = result.get("events") or {}
        page = block.get("events") or []
        if total is None and block.get("count") is not None:
            total = int(block["count"])
        for event in page:
            if not isinstance(event, dict):
                continue
            key = event_key(event)
            if key in seen:
                continue
            seen.add(key)
            events.append(event)
        if len(page) < PAGE_SIZE:
            exhausted = True
            break
        metadata = page[-1].get("$metadata") if isinstance(page[-1], dict) else {}
        cursor = str(metadata.get("id") or "") if isinstance(metadata, dict) else ""
        if not cursor or cursor == payload.get("offset"):
            break
        payload["offset"] = cursor
    return events, total, not exhausted and total is not None and len(events) < total


def parse_start(end: dt.datetime) -> dt.datetime:
    raw = os.environ.get("AUDIT_FROM", "").strip()
    if not raw:
        return end - dt.timedelta(minutes=LOOKBACK_MINUTES)
    try:
        value = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeError(f"AUDIT_FROM is invalid: {raw}") from error
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def finite(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def fields(event: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    metadata = event.get("$metadata")
    workers = event.get("$workers")
    return (
        metadata if isinstance(metadata, dict) else {},
        workers if isinstance(workers, dict) else {},
    )


def event_key(event: dict[str, Any]) -> str:
    metadata, workers = fields(event)
    identifier = metadata.get("id") or metadata.get("requestId") or workers.get("requestId")
    if identifier:
        return str(identifier)
    return json.dumps(
        [event.get("timestamp"), metadata.get("service"), workers.get("eventType"), workers.get("cpuTimeMs")],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def request_id(event: dict[str, Any]) -> str:
    metadata, workers = fields(event)
    identifier = str(metadata.get("requestId") or workers.get("requestId") or "")
    return f"{worker_name(event)}:{identifier}" if identifier else ""


def error_priority(event: dict[str, Any]) -> int:
    metadata, workers = fields(event)
    source = event.get("source") if isinstance(event.get("source"), dict) else {}
    outcome = str(workers.get("outcome") or "").lower()
    level = str(metadata.get("level") or source.get("level") or "").lower()
    status = finite(metadata.get("statusCode") or workers.get("statusCode"))
    return (
        (8 if outcome not in OK_OUTCOMES else 0)
        + (4 if finite(workers.get("cpuTimeMs")) is not None else 0)
        + (2 if status is not None and status >= 500 else 0)
        + (1 if bool(metadata.get("error")) or level in {"error", "fatal"} else 0)
    )


def timestamp_ms(event: dict[str, Any]) -> float:
    metadata, _ = fields(event)
    raw = event.get("timestamp") or metadata.get("timestamp")
    numeric = finite(raw)
    if numeric is not None:
        return numeric
    if isinstance(raw, str):
        try:
            parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.timestamp() * 1000
        except ValueError:
            return 0
    return 0


def version_id(event: dict[str, Any]) -> str:
    _, workers = fields(event)
    version = workers.get("scriptVersion")
    return str(version.get("id") or "") if isinstance(version, dict) else ""


def worker_name(event: dict[str, Any]) -> str:
    metadata, workers = fields(event)
    return str(metadata.get("service") or workers.get("scriptName") or "unknown")


def invocation_class(event: dict[str, Any]) -> str:
    metadata, workers = fields(event)
    model = str(workers.get("executionModel") or "stateless")
    if model == "durableObject":
        return "durableObject"
    event_type = str(workers.get("eventType") or metadata.get("origin") or "").strip().lower()
    if event_type == "queue":
        return "queue"
    if event_type == "cron":
        return "cron"
    if event_type == "fetch":
        return "http"
    return "stateless"


def cpu_budget_ms(event: dict[str, Any]) -> float:
    policy = invocation_class(event)
    if policy == "queue":
        return QUEUE_CPU_BUDGET_MS
    if policy == "durableObject":
        return DURABLE_OBJECT_CPU_BUDGET_MS
    return STATELESS_CPU_BUDGET_MS


def cpu_limit_outcome(event: dict[str, Any]) -> bool:
    _, workers = fields(event)
    normalized = "".join(character for character in str(workers.get("outcome") or "").lower() if character.isalnum())
    return normalized == "exceededcpu"


def live_tail_events() -> list[dict[str, Any]]:
    if not LIVE_TAIL_LOG.exists():
        return []
    events: list[dict[str, Any]] = []
    for line in LIVE_TAIL_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.startswith("LIVE_TAIL_EVENT="):
            continue
        try:
            value = json.loads(line.removeprefix("LIVE_TAIL_EVENT="))
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and worker_name(value) in WORKERS:
            event = dict(value)
            event["_diagnostic_source"] = "live_tail"
            events.append(event)
    return events


def merge_events(*groups: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for group in groups:
        for event in group:
            merged[event_key(event)] = event
    return list(merged.values())


def clean_url(value: Any) -> str:
    if not value:
        return "-"
    parsed = urllib.parse.urlsplit(str(value))
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))[:180]


def detail(event: dict[str, Any]) -> dict[str, Any]:
    metadata, workers = fields(event)
    worker_event = workers.get("event") if isinstance(workers.get("event"), dict) else {}
    request = worker_event.get("request") if isinstance(worker_event.get("request"), dict) else {}
    source = event.get("source") if isinstance(event.get("source"), dict) else {}
    model = str(workers.get("executionModel") or "stateless")
    message = metadata.get("error") or metadata.get("message") or source.get("message") or "-"
    return {
        "time": str(event.get("timestamp") or metadata.get("timestamp") or "-")[:48],
        "worker": worker_name(event)[:80],
        "version": version_id(event)[:80],
        "source": str(event.get("_diagnostic_source") or "persisted"),
        "cpu_ms": finite(workers.get("cpuTimeMs")),
        "budget_ms": cpu_budget_ms(event),
        "budget_class": invocation_class(event),
        "model": model[:40],
        "outcome": str(workers.get("outcome") or "")[:40],
        "event_type": str(workers.get("eventType") or "-")[:40],
        "message": " ".join(str(message).split())[:220],
        "url": clean_url(metadata.get("url") or request.get("url") or worker_event.get("url")),
    }


def exempt(event: dict[str, Any]) -> bool:
    if not EXEMPT_MARKERS:
        return False
    compact = json.dumps(event, ensure_ascii=False, separators=(",", ":")).lower()
    return any(marker in compact for marker in EXEMPT_MARKERS)


def error_event(event: dict[str, Any]) -> bool:
    metadata, workers = fields(event)
    source = event.get("source") if isinstance(event.get("source"), dict) else {}
    level = str(metadata.get("level") or source.get("level") or "").lower()
    outcome = str(workers.get("outcome") or "").lower()
    return bool(metadata.get("error")) or level in {"error", "fatal"} or outcome not in OK_OUTCOMES


def current_events(
    persisted: list[dict[str, Any]],
    live: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, str], int]:
    all_events = merge_events(persisted, live)
    invocations = [event for event in all_events if detail(event)["cpu_ms"] is not None]
    latest: dict[str, tuple[float, str]] = {}
    for event in invocations:
        worker = worker_name(event)
        version = version_id(event)
        if worker not in WORKERS or not version:
            continue
        candidate = (timestamp_ms(event), version)
        if worker not in latest or candidate[0] >= latest[worker][0]:
            latest[worker] = candidate
    versions = {worker: value[1] for worker, value in latest.items()}

    selected: list[dict[str, Any]] = []
    for event in all_events:
        worker = worker_name(event)
        if worker not in WORKERS:
            continue
        expected = versions.get(worker)
        observed = version_id(event)
        if expected and observed and observed != expected:
            continue
        selected.append(event)
    selected_invocations = sum(1 for event in selected if detail(event)["cpu_ms"] is not None)
    old_versions = len(invocations) - selected_invocations
    return selected, versions, old_versions


def evaluate(
    events: list[dict[str, Any]],
    truncated: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, list[float]], list[str], bool]:
    violations: list[dict[str, Any]] = []
    exempted: list[dict[str, Any]] = []
    error_items: dict[str, tuple[int, dict[str, Any]]] = {}
    samples: dict[str, list[float]] = {worker: [] for worker in WORKERS}
    for event in events:
        item = detail(event)
        cpu_ms = item["cpu_ms"]
        if item["worker"] in samples and cpu_ms is not None:
            samples[item["worker"]].append(cpu_ms)
        if error_event(event):
            key = request_id(event) or event_key(event)
            priority = error_priority(event)
            current = error_items.get(key)
            if current is None or priority > current[0]:
                error_items[key] = (priority, item)
        terminal_cpu = cpu_limit_outcome(event)
        numeric_overage = cpu_ms is not None and cpu_ms > item["budget_ms"]
        if not terminal_cpu and not numeric_overage:
            continue
        if not terminal_cpu and exempt(event):
            exempted.append(item)
        else:
            violations.append(item)
    errors = [item for _, item in error_items.values()]
    missing = [worker for worker, values in samples.items() if not values]
    return violations, exempted, errors, samples, missing, not truncated and not missing


def stats(values: list[float]) -> dict[str, float | int | None]:
    return {
        "samples": len(values),
        "avg_ms": (sum(values) / len(values)) if values else None,
        "max_ms": max(values) if values else None,
    }


def grouped_cpu_stats(events: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, dict[str, list[float]]]]:
    class_counts: dict[str, int] = {}
    grouped: dict[str, dict[str, list[float]]] = {worker: {} for worker in WORKERS}
    for event in events:
        item = detail(event)
        cpu_ms = item["cpu_ms"]
        if cpu_ms is None:
            continue
        policy = item["budget_class"]
        class_counts[policy] = class_counts.get(policy, 0) + 1
        worker = item["worker"]
        if worker in grouped:
            grouped[worker].setdefault(policy, []).append(cpu_ms)
    return class_counts, grouped


def self_test() -> int:
    def event(
        identifier: str,
        *,
        timestamp: str,
        version: str,
        cpu: float | None,
        event_type: str,
        model: str = "stateless",
        outcome: str = "ok",
        request: str | None = None,
        level: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            "id": identifier,
            "service": "a",
            "requestId": request or identifier,
            "origin": event_type,
        }
        if level:
            metadata["level"] = level
        if error:
            metadata["error"] = error
        workers: dict[str, Any] = {
            "scriptVersion": {"id": version},
            "outcome": outcome,
            "eventType": event_type,
            "executionModel": model,
        }
        if cpu is not None:
            workers["cpuTimeMs"] = cpu
        return {"timestamp": timestamp, "$metadata": metadata, "$workers": workers}

    old = event("old", timestamp="2026-07-22T00:00:00Z", version="v1", cpu=99, event_type="cron")
    persisted_current = event(
        "persisted-current",
        timestamp="2026-07-22T01:00:00Z",
        version="v2",
        cpu=4,
        event_type="fetch",
    )
    live_error = event(
        "live-error",
        timestamp="2026-07-22T01:02:00Z",
        version="v3",
        cpu=3,
        event_type="fetch",
        outcome="exception",
        request="shared-request",
    )
    live_error["_diagnostic_source"] = "live_tail"
    live_error_log = event(
        "live-error-log",
        timestamp="2026-07-22T01:02:00.100Z",
        version="v3",
        cpu=None,
        event_type="fetch",
        request="shared-request",
        level="error",
        error="duplicate console error",
    )
    live_error_log["_diagnostic_source"] = "live_tail"
    cron_overage = event(
        "cron-overage",
        timestamp="2026-07-22T01:03:00Z",
        version="v3",
        cpu=12,
        event_type="cron",
    )
    queue_ok = event(
        "queue-ok",
        timestamp="2026-07-22T01:04:00Z",
        version="v3",
        cpu=37,
        event_type="queue",
    )
    durable_ok = event(
        "durable-ok",
        timestamp="2026-07-22T01:05:00Z",
        version="v3",
        cpu=45,
        event_type="fetch",
        model="durableObject",
    )
    queue_terminal = event(
        "queue-terminal",
        timestamp="2026-07-22T01:06:00Z",
        version="v3",
        cpu=1,
        event_type="queue",
        outcome="exceededCpu",
    )
    original = globals()["WORKERS"]
    globals()["WORKERS"] = ("a",)
    try:
        selected, versions, excluded = current_events(
            [old, persisted_current],
            [live_error, live_error_log, cron_overage, queue_ok, durable_ok, queue_terminal],
        )
        assert versions == {"a": "v3"}
        assert excluded == 2
        assert {version_id(item) for item in selected if version_id(item)} == {"v3"}
        violations, exempted, errors, samples, missing, coverage = evaluate(selected, False)
        assert {item["outcome"] for item in violations} == {"ok", "exceededCpu"}
        assert {item["budget_class"] for item in violations} == {"cron", "queue"}
        assert not exempted
        assert {item["outcome"] for item in errors} == {"exception", "exceededCpu"}
        assert len(errors) == 2
        assert sorted(samples["a"]) == [1.0, 3.0, 12.0, 37.0, 45.0]
        assert not missing and coverage
        assert detail(queue_ok)["budget_class"] == "queue"
        assert detail(queue_ok)["budget_ms"] == QUEUE_CPU_BUDGET_MS
        assert detail(durable_ok)["budget_ms"] == DURABLE_OBJECT_CPU_BUDGET_MS
        assert detail(cron_overage)["budget_ms"] == STATELESS_CPU_BUDGET_MS
        assert timestamp_ms(queue_terminal) > timestamp_ms(persisted_current) > timestamp_ms(old)
    finally:
        globals()["WORKERS"] = original
    print("invocation-aware telemetry audit self-test passed")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    if not TOKEN or not ACCOUNT_ID or not WORKERS:
        raise RuntimeError("Cloudflare token, account ID, and Worker list are required")
    end = dt.datetime.now(dt.timezone.utc)
    start = parse_start(end)
    persisted, matching, truncated = query_events(
        ACCOUNT_ID,
        int(start.timestamp() * 1000),
        int(end.timestamp() * 1000),
    )
    live = live_tail_events()
    events, versions, old_versions = current_events(persisted, live)
    violations, exempted, errors, samples, missing, coverage_ok = evaluate(events, truncated)
    class_counts, grouped = grouped_cpu_stats(events)
    model_counts: dict[str, int] = {}
    for event in events:
        item = detail(event)
        if item["cpu_ms"] is not None:
            model_counts[item["model"]] = model_counts.get(item["model"], 0) + 1
    worker_stats = {
        worker: {
            "version": versions.get(worker),
            **stats(values),
            "classes": {policy: stats(class_values) for policy, class_values in grouped[worker].items()},
        }
        for worker, values in samples.items()
    }
    report = {
        "window": {
            "from": start.isoformat().replace("+00:00", "Z"),
            "to": end.isoformat().replace("+00:00", "Z"),
        },
        "events": {
            "persisted_matching": matching,
            "persisted_fetched": len(persisted),
            "live_fetched": len(live),
            "current_version_events": len(events),
            "old_version_invocations_excluded": old_versions,
            "truncated": truncated,
        },
        "cpu_policy": {
            "stateless_budget_ms": STATELESS_CPU_BUDGET_MS,
            "http_cron_budget_ms": STATELESS_CPU_BUDGET_MS,
            "queue_consumer_budget_ms": QUEUE_CPU_BUDGET_MS,
            "durable_object_budget_ms": DURABLE_OBJECT_CPU_BUDGET_MS,
            "coverage_ok": coverage_ok,
            "missing_workers": missing,
            "models": model_counts,
            "classes": class_counts,
            "workers": worker_stats,
            "violations": len(violations),
            "exempted": len(exempted),
            "samples": violations[:20],
        },
        "errors": {"count": len(errors), "samples": errors[:20]},
    }
    print("TELEMETRY_AUDIT=" + json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    print(
        f"CPU_POLICY http_cron_budget_ms={STATELESS_CPU_BUDGET_MS:g} "
        f"queue_consumer_budget_ms={QUEUE_CPU_BUDGET_MS:g} "
        f"durable_object_budget_ms={DURABLE_OBJECT_CPU_BUDGET_MS:g} "
        f"samples={sum(len(values) for values in samples.values())} "
        f"violations={len(violations)} exempted={len(exempted)} old_versions={old_versions} "
        f"truncated={truncated} coverage_ok={coverage_ok}"
    )
    for worker, worker_values in grouped.items():
        for policy, values in worker_values.items():
            item_stats = stats(values)
            budget = (
                QUEUE_CPU_BUDGET_MS if policy == "queue"
                else DURABLE_OBJECT_CPU_BUDGET_MS if policy == "durableObject"
                else STATELESS_CPU_BUDGET_MS
            )
            print(
                f"CPU_CLASS worker={worker} version={versions.get(worker)} class={policy} "
                f"budget_ms={budget:g} samples={item_stats['samples']} "
                f"avg_ms={item_stats['avg_ms']} max_ms={item_stats['max_ms']}"
            )
    for worker, item_stats in worker_stats.items():
        print(
            f"CPU_WORKER worker={worker} version={item_stats['version']} samples={item_stats['samples']} "
            f"avg_ms={item_stats['avg_ms']} max_ms={item_stats['max_ms']}"
        )
    for item in violations[:20]:
        print(
            "::error title=Worker CPU policy violation::"
            f"worker={item['worker']} version={item['version']} cpu_ms={item['cpu_ms']} "
            f"budget_ms={item['budget_ms']} class={item['budget_class']} model={item['model']} "
            f"source={item['source']} outcome={item['outcome']} event={item['event_type']} url={item['url']}"
        )
    for item in errors[:20]:
        print(
            "::error title=Cloudflare Worker error::"
            f"worker={item['worker']} version={item['version']} source={item['source']} "
            f"outcome={item['outcome']} message={item['message']} url={item['url']}"
        )
    if not coverage_ok:
        print(
            "::error title=Worker CPU policy has incomplete coverage::"
            f"missing_workers={','.join(missing)} truncated={truncated}"
        )

    summary = [
        "## Cloudflare Telemetry audit",
        "",
        f"- Window: `{report['window']['from']}` to `{report['window']['to']}`",
        f"- HTTP and Cron CPU policy: `<= {STATELESS_CPU_BUDGET_MS:g} ms` per invocation",
        f"- Queue consumer CPU policy: `<= {QUEUE_CPU_BUDGET_MS:g} ms` per invocation",
        f"- Durable Object CPU policy: `<= {DURABLE_OBJECT_CPU_BUDGET_MS:g} ms` per invocation",
        f"- Current-version CPU samples: `{sum(len(values) for values in samples.values())}`",
        f"- Live-tail samples received: `{len(live)}`",
        f"- Old-version invocations excluded: `{old_versions}`",
        f"- CPU coverage: `{'OK' if coverage_ok else 'MISSING'}`",
        f"- CPU violations: `{len(violations)}`",
        f"- Error invocations: `{len(errors)}`",
        "",
        "| Worker | Class | Budget ms | Samples | Average ms | Maximum ms |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for worker, worker_values in grouped.items():
        version = (versions.get(worker) or "-")[:12]
        for policy, values in worker_values.items():
            item_stats = stats(values)
            budget = (
                QUEUE_CPU_BUDGET_MS if policy == "queue"
                else DURABLE_OBJECT_CPU_BUDGET_MS if policy == "durableObject"
                else STATELESS_CPU_BUDGET_MS
            )
            summary.append(
                f"| `{worker}` (`{version}`) | `{policy}` | {budget:g} | "
                f"{item_stats['samples']} | {item_stats['avg_ms']} | {item_stats['max_ms']} |"
            )
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as output:
            output.write("\n".join(summary) + "\n")
    return 1 if violations or errors or not coverage_ok else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"::error title=Cloudflare Telemetry audit::{str(error).replace(chr(10), ' ')[:1000]}")
        raise
