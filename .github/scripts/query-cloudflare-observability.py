#!/usr/bin/env python3
"""Publish a sanitized Cloudflare Workers observability summary to GitHub Actions."""

from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

API_BASE = "https://api.cloudflare.com/client/v4"
GRAPHQL_URL = f"{API_BASE}/graphql"
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
WORKERS = [item.strip() for item in os.environ.get("CLOUDFLARE_WORKERS", "").split(",") if item.strip()]
LOOKBACK_MINUTES = max(1, int(os.environ.get("LOOKBACK_MINUTES", "60")))
ERROR_LEVELS = {"error", "fatal"}
WARNING_LEVELS = {"warn", "warning"}
CPU_CLASS_ORDER = {"http": 0, "cron": 1, "queue": 2, "durableObject": 3}
CPU_METRICS = {"count": "cpu_samples", "median": "cpu_p50_ms", "p99": "cpu_p99_ms"}


def request_json(url: str, *, method: str = "GET", payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "github-actions-cloudflare-observability",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"Cloudflare API HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Cloudflare API request failed: {error.reason}") from error
    errors = data.get("errors")
    if data.get("success") is False or errors:
        raise RuntimeError(f"Cloudflare API error: {json.dumps(errors, ensure_ascii=False)[:2000]}")
    return data


def iso(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def worker_metrics(account_id: str, worker: str, start: dt.datetime, end: dt.datetime) -> dict[str, Any]:
    query = """
      query WorkerMetrics($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string) {
        viewer {
          accounts(filter: {accountTag: $accountTag}) {
            workersInvocationsAdaptive(limit: 1, filter: {
              scriptName: $scriptName,
              datetime_geq: $datetimeStart,
              datetime_leq: $datetimeEnd
            }) {
              sum { requests errors subrequests }
            }
          }
        }
      }
    """
    data = request_json(
        GRAPHQL_URL,
        method="POST",
        payload={
            "query": query,
            "variables": {
                "accountTag": account_id,
                "datetimeStart": iso(start),
                "datetimeEnd": iso(end),
                "scriptName": worker,
            },
        },
    )
    accounts = (((data.get("data") or {}).get("viewer") or {}).get("accounts") or [])
    rows = (accounts[0].get("workersInvocationsAdaptive") or []) if accounts else []
    row = rows[0] if rows else {}
    sums = row.get("sum") or {}
    return {
        "worker": worker,
        "requests": int(sums.get("requests") or 0),
        "errors": int(sums.get("errors") or 0),
        "subrequests": int(sums.get("subrequests") or 0),
    }


def service_filters() -> list[dict[str, Any]]:
    return [
        {
            "kind": "filter",
            "key": "$metadata.service",
            "operation": "eq",
            "type": "string",
            "value": worker,
        }
        for worker in WORKERS
    ]


def worker_script_filters() -> list[dict[str, Any]]:
    return [
        {
            "kind": "filter",
            "key": "$workers.scriptName",
            "operation": "eq",
            "type": "string",
            "value": worker,
        }
        for worker in WORKERS
    ]


def group_values(aggregate: dict[str, Any]) -> dict[str, Any]:
    groups = aggregate.get("groups")
    if isinstance(groups, dict):
        return groups
    values: dict[str, Any] = {}
    if isinstance(groups, list):
        for group in groups:
            if isinstance(group, dict) and group.get("key") is not None:
                values[str(group["key"])] = group.get("value")
    return values


def cpu_class_label(event_type: Any, execution_model: Any) -> str:
    event = str(event_type or "").strip().lower()
    model = str(execution_model or "").strip()
    if model == "durableObject":
        return f"durableObject/{event or 'unknown'}"
    if event == "queue":
        return "queue"
    if event in {"scheduled", "cron"}:
        return "cron"
    if event == "fetch":
        return "http"
    return event or model or "unknown"


def calculation_metric(calculation: dict[str, Any]) -> str:
    alias = str(calculation.get("alias") or "").strip()
    if alias in CPU_METRICS.values():
        return alias
    operator = str(calculation.get("calculation") or calculation.get("operator") or "").strip().lower()
    return CPU_METRICS.get(operator, "")


def parse_cpu_calculations(calculations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for calculation in calculations:
        if not isinstance(calculation, dict):
            continue
        metric = calculation_metric(calculation)
        if not metric:
            continue
        for aggregate in calculation.get("aggregates") or []:
            if not isinstance(aggregate, dict):
                continue
            groups = group_values(aggregate)
            worker = str(groups.get("$workers.scriptName") or groups.get("$metadata.service") or "")
            event_type = str(groups.get("$workers.eventType") or "")
            execution_model = str(groups.get("$workers.executionModel") or "")
            if worker not in WORKERS:
                continue
            key = (worker, event_type, execution_model)
            row = grouped.setdefault(
                key,
                {
                    "worker": worker,
                    "class": cpu_class_label(event_type, execution_model),
                    "event_type": event_type or "-",
                    "execution_model": execution_model or "-",
                    "samples": None,
                    "cpu_p50_ms": None,
                    "cpu_p99_ms": None,
                },
            )
            value = aggregate.get("value")
            if metric == "cpu_samples":
                sample_value = value if value is not None else aggregate.get("count")
                if sample_value is not None:
                    row["samples"] = int(float(sample_value))
            elif metric == "cpu_p50_ms":
                row["cpu_p50_ms"] = value
            elif metric == "cpu_p99_ms":
                row["cpu_p99_ms"] = value
    order = {worker: index for index, worker in enumerate(WORKERS)}
    return sorted(
        grouped.values(),
        key=lambda row: (
            order.get(row["worker"], len(order)),
            CPU_CLASS_ORDER.get(str(row["class"]).split("/", 1)[0], 99),
            row["class"],
            row["event_type"],
            row["execution_model"],
        ),
    )


def telemetry_cpu_metrics(account_id: str, start: dt.datetime, end: dt.datetime) -> list[dict[str, Any]]:
    payload = {
        "queryId": "github-actions-worker-cpu-by-invocation-class",
        "dry": True,
        "ignoreSeries": True,
        "timeframe": {
            "from": int(start.timestamp() * 1000),
            "to": int(end.timestamp() * 1000),
        },
        "parameters": {
            "view": "calculations",
            "limit": 2000,
            "datasets": [],
            "filterCombination": "and",
            "filters": [
                {"kind": "group", "filterCombination": "or", "filters": worker_script_filters()},
                {
                    "kind": "filter",
                    "key": "$workers.cpuTimeMs",
                    "operation": "exists",
                    "type": "number",
                },
            ],
            "calculations": [
                {"operator": "count", "alias": "cpu_samples"},
                {
                    "operator": "median",
                    "alias": "cpu_p50_ms",
                    "key": "$workers.cpuTimeMs",
                    "keyType": "number",
                },
                {
                    "operator": "p99",
                    "alias": "cpu_p99_ms",
                    "key": "$workers.cpuTimeMs",
                    "keyType": "number",
                },
            ],
            "groupBys": [
                {"type": "string", "value": "$workers.scriptName"},
                {"type": "string", "value": "$workers.eventType"},
                {"type": "string", "value": "$workers.executionModel"},
            ],
        },
    }
    endpoint = f"{API_BASE}/accounts/{account_id}/workers/observability/telemetry/query"
    try:
        data = request_json(endpoint, method="POST", payload=payload)
    except RuntimeError as error:
        print(f"::warning title=CPU execution-model fallback::{str(error).replace(chr(10), ' ')[:500]}")
        payload["parameters"]["groupBys"] = payload["parameters"]["groupBys"][:2]
        data = request_json(endpoint, method="POST", payload=payload)
    calculations = ((data.get("result") or {}).get("calculations") or [])
    return parse_cpu_calculations(calculations)


def telemetry_diagnostics(account_id: str, start: dt.datetime, end: dt.datetime) -> list[dict[str, Any]]:
    services = service_filters()
    diagnostic_markers: list[dict[str, Any]] = [
        {
            "kind": "filter",
            "key": "$metadata.error",
            "operation": "exists",
            "type": "string",
        },
        *[
            {
                "kind": "filter",
                "key": "$metadata.level",
                "operation": "eq",
                "type": "string",
                "value": level,
            }
            for level in ("error", "fatal", "warn", "warning")
        ],
    ]
    filters: list[dict[str, Any]] = [
        {"kind": "group", "filterCombination": "or", "filters": services},
        {"kind": "group", "filterCombination": "or", "filters": diagnostic_markers},
    ]
    payload = {
        "queryId": "github-actions-worker-diagnostics",
        "dry": True,
        "timeframe": {
            "from": int(start.timestamp() * 1000),
            "to": int(end.timestamp() * 1000),
        },
        "parameters": {
            "view": "events",
            "limit": 100,
            "datasets": [],
            "filterCombination": "and",
            "filters": filters,
        },
    }
    try:
        data = request_json(
            f"{API_BASE}/accounts/{account_id}/workers/observability/telemetry/query",
            method="POST",
            payload=payload,
        )
    except RuntimeError as error:
        print(f"::warning title=Telemetry filter fallback::{str(error).replace(chr(10), ' ')[:500]}")
        payload["parameters"]["filters"] = [filters[1]]
        data = request_json(
            f"{API_BASE}/accounts/{account_id}/workers/observability/telemetry/query",
            method="POST",
            payload=payload,
        )
    events = (((data.get("result") or {}).get("events") or {}).get("events") or [])
    selected: list[dict[str, Any]] = []
    for event in events:
        metadata = event.get("$metadata") if isinstance(event.get("$metadata"), dict) else {}
        workers = event.get("$workers") if isinstance(event.get("$workers"), dict) else {}
        service = str(metadata.get("service") or workers.get("scriptName") or "")
        if service in WORKERS:
            selected.append(event)
    return selected


def event_severity(event: dict[str, Any]) -> str:
    metadata = event.get("$metadata") if isinstance(event.get("$metadata"), dict) else {}
    source = event.get("source") if isinstance(event.get("source"), dict) else {}
    level = str(metadata.get("level") or source.get("level") or "").strip().lower()
    if bool(metadata.get("error")) or level in ERROR_LEVELS:
        return "error"
    if level in WARNING_LEVELS:
        return "warning"
    return "info"


def sanitize_text(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"\bBearer\s+[^\s,;\"'}]+", "Bearer [redacted]", text, flags=re.IGNORECASE)
    text = re.sub(
        r"([\"']?\b(?:api[_-]?token|token|secret|api[_-]?key)\b[\"']?\s*[:=]\s*[\"']?)[^\s,;\"'}]+",
        r"\1[redacted]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"([?&](?:token|key|secret|signature|sig|auth)=)[^\s&#)]+",
        r"\1[redacted]",
        text,
        flags=re.IGNORECASE,
    )
    return text


def clean_text(value: Any, limit: int = 180) -> str:
    text = " ".join(sanitize_text(value).replace("|", "\\|").split())
    return html.escape(text[:limit]) or "-"


def clean_url(value: Any) -> str:
    if not value:
        return "-"
    parsed = urllib.parse.urlsplit(str(value))
    return clean_text(urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", "")))


def event_row(event: dict[str, Any]) -> tuple[str, str, str, str]:
    metadata = event.get("$metadata") if isinstance(event.get("$metadata"), dict) else {}
    workers = event.get("$workers") if isinstance(event.get("$workers"), dict) else {}
    worker_event = workers.get("event") if isinstance(workers.get("event"), dict) else {}
    request = worker_event.get("request") if isinstance(worker_event.get("request"), dict) else {}
    source = event.get("source") if isinstance(event.get("source"), dict) else {}
    service = metadata.get("service") or workers.get("scriptName") or "unknown"
    timestamp = event.get("timestamp") or metadata.get("timestamp") or "-"
    message = metadata.get("error") or metadata.get("message") or source.get("message") or source or "diagnostic event"
    url = metadata.get("url") or request.get("url") or worker_event.get("url")
    return clean_text(timestamp, 40), clean_text(service, 80), clean_text(message), clean_url(url)


def number(value: Any) -> str:
    if value is None:
        return "-"
    return f"{float(value):.3f}".rstrip("0").rstrip(".")


def append_event_section(lines: list[str], title: str, events: list[dict[str, Any]], empty: str) -> None:
    lines.extend(["", f"### {title} ({len(events)} samples)", ""])
    if not events:
        lines.append(empty)
        return
    lines.extend(["| Time | Worker | Message | URL |", "|---|---|---|---|"])
    for event in events[:10]:
        timestamp, service, message, url = event_row(event)
        lines.append(f"| {timestamp} | `{service}` | {message} | {url} |")


def self_test() -> int:
    def event(level: str | None = None, error: str | None = None) -> dict[str, Any]:
        metadata: dict[str, Any] = {}
        if level is not None:
            metadata["level"] = level
        if error is not None:
            metadata["error"] = error
        return {"$metadata": metadata}

    assert event_severity(event("error")) == "error"
    assert event_severity(event("fatal")) == "error"
    assert event_severity(event(error="boom")) == "error"
    assert event_severity(event("warn")) == "warning"
    assert event_severity(event("warning")) == "warning"
    assert event_severity(event("info")) == "info"
    assert sanitize_text("Bearer abcdefghijklmnop") == "Bearer [redacted]"
    assert "supersecret" not in sanitize_text("token=supersecret")

    original = list(WORKERS)
    WORKERS[:] = ["a"]
    try:
        groups_http = [
            {"key": "$workers.scriptName", "value": "a"},
            {"key": "$workers.eventType", "value": "fetch"},
            {"key": "$workers.executionModel", "value": "stateless"},
        ]
        groups_queue = [
            {"key": "$workers.scriptName", "value": "a"},
            {"key": "$workers.eventType", "value": "queue"},
            {"key": "$workers.executionModel", "value": "stateless"},
        ]
        rows = parse_cpu_calculations(
            [
                {
                    "alias": "cpu_samples",
                    "calculation": "count",
                    "aggregates": [{"value": 9, "groups": groups_http}, {"value": 2, "groups": groups_queue}],
                },
                {
                    "alias": "cpu_p50_ms",
                    "calculation": "median",
                    "aggregates": [{"value": 1.5, "groups": groups_http}, {"value": 40, "groups": groups_queue}],
                },
                {
                    "alias": "cpu_p99_ms",
                    "calculation": "p99",
                    "aggregates": [{"value": 8, "groups": groups_http}, {"value": 200, "groups": groups_queue}],
                },
            ]
        )
        assert [(row["class"], row["samples"]) for row in rows] == [("http", 9), ("queue", 2)]
        assert rows[0]["cpu_p50_ms"] == 1.5 and rows[0]["cpu_p99_ms"] == 8
        assert rows[1]["cpu_p50_ms"] == 40 and rows[1]["cpu_p99_ms"] == 200

        aliasless_rows = parse_cpu_calculations(
            [
                {"calculation": "count", "aggregates": [{"count": 4, "groups": groups_http}]},
                {"calculation": "median", "aggregates": [{"value": 2.5, "groups": groups_http}]},
                {"calculation": "P99", "aggregates": [{"value": 9.5, "groups": groups_http}]},
            ]
        )
        assert len(aliasless_rows) == 1
        assert aliasless_rows[0]["samples"] == 4
        assert aliasless_rows[0]["cpu_p50_ms"] == 2.5
        assert aliasless_rows[0]["cpu_p99_ms"] == 9.5
        assert worker_script_filters()[0]["key"] == "$workers.scriptName"
        assert cpu_class_label("scheduled", "stateless") == "cron"
        assert cpu_class_label("fetch", "durableObject") == "durableObject/fetch"
    finally:
        WORKERS[:] = original

    print("observability severity and CPU class self-test passed")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    if not TOKEN or not ACCOUNT_ID or not WORKERS:
        raise RuntimeError("Cloudflare token, account ID, and Worker list are required")
    end = dt.datetime.now(dt.timezone.utc)
    start = end - dt.timedelta(minutes=LOOKBACK_MINUTES)
    metrics = [worker_metrics(ACCOUNT_ID, worker, start, end) for worker in WORKERS]
    cpu_metrics = telemetry_cpu_metrics(ACCOUNT_ID, start, end)
    diagnostics = telemetry_diagnostics(ACCOUNT_ID, start, end)
    errors = [event for event in diagnostics if event_severity(event) == "error"]
    warnings = [event for event in diagnostics if event_severity(event) == "warning"]
    total_errors = sum(item["errors"] for item in metrics)

    lines = [
        "## Cloudflare Observability",
        "",
        f"- Window: `{iso(start)}` to `{iso(end)}`",
        f"- Account: `{ACCOUNT_ID[:8]}…`",
        "- Sources: GraphQL Analytics API and Workers Observability Telemetry API",
        "- CPU percentiles are separated by invocation event type and execution model when available.",
        f"- Persisted warnings: `{len(warnings)}` (reported without failing the gate)",
        "",
        "### Worker activity",
        "",
        "| Worker | Requests | Errors | Error rate | Subrequests |",
        "|---|---:|---:|---:|---:|",
    ]
    for item in metrics:
        requests = item["requests"]
        rate = (item["errors"] / requests * 100) if requests else 0
        lines.append(
            f"| `{item['worker']}` | {requests} | {item['errors']} | {rate:.2f}% | {item['subrequests']} |"
        )

    lines.extend(
        [
            "",
            "### CPU by invocation class",
            "",
            "| Worker | Class | Event type | Execution model | Samples | CPU p50 ms | CPU p99 ms |",
            "|---|---|---|---|---:|---:|---:|",
        ]
    )
    if cpu_metrics:
        for item in cpu_metrics:
            lines.append(
                f"| `{item['worker']}` | `{item['class']}` | `{item['event_type']}` | "
                f"`{item['execution_model']}` | {item['samples'] if item['samples'] is not None else '-'} | "
                f"{number(item['cpu_p50_ms'])} | {number(item['cpu_p99_ms'])} |"
            )
    else:
        lines.append("| - | - | - | - | 0 | - | - |")

    append_event_section(
        lines,
        "Recent error events",
        errors,
        "No matching persisted error events were returned for this window.",
    )
    append_event_section(
        lines,
        "Recent warning events",
        warnings,
        "No matching persisted warning events were returned for this window.",
    )

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as summary:
            summary.write("\n".join(lines) + "\n")
    else:
        print("\n".join(lines))
    if warnings:
        print(
            "::warning title=Cloudflare Worker warnings::"
            f"persisted_warning_events={len(warnings)} lookback_minutes={LOOKBACK_MINUTES}"
        )
    if total_errors or errors:
        print(
            "::error title=Cloudflare Worker errors::"
            f"invocation_errors={total_errors} persisted_error_events={len(errors)} "
            f"lookback_minutes={LOOKBACK_MINUTES}"
        )
    return 1 if total_errors or errors else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"::error title=Cloudflare Observability::{str(error).replace(chr(10), ' ')[:1000]}")
        raise
