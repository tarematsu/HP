#!/usr/bin/env python3
"""Publish a sanitized Cloudflare Workers observability summary to GitHub Actions."""

from __future__ import annotations

import datetime as dt
import html
import json
import os
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


def microseconds_to_ms(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value) / 1000.0
    except (TypeError, ValueError):
        return None


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
              quantiles { cpuTimeP50 cpuTimeP99 }
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
    quantiles = row.get("quantiles") or {}
    return {
        "worker": worker,
        "requests": int(sums.get("requests") or 0),
        "errors": int(sums.get("errors") or 0),
        "subrequests": int(sums.get("subrequests") or 0),
        # Cloudflare GraphQL reports these quantiles in microseconds.
        "cpu_p50_ms": microseconds_to_ms(quantiles.get("cpuTimeP50")),
        "cpu_p99_ms": microseconds_to_ms(quantiles.get("cpuTimeP99")),
    }


def telemetry_errors(account_id: str, start: dt.datetime, end: dt.datetime) -> list[dict[str, Any]]:
    services = [
        {
            "kind": "filter",
            "key": "$metadata.service",
            "operation": "eq",
            "type": "string",
            "value": worker,
        }
        for worker in WORKERS
    ]
    error_markers: list[dict[str, Any]] = [
        {
            "kind": "filter",
            "key": "$metadata.error",
            "operation": "exists",
            "type": "string",
        },
        {
            "kind": "filter",
            "key": "$metadata.level",
            "operation": "eq",
            "type": "string",
            "value": "error",
        },
        {
            "kind": "filter",
            "key": "$metadata.level",
            "operation": "eq",
            "type": "string",
            "value": "fatal",
        },
    ]
    filters: list[dict[str, Any]] = [
        {"kind": "group", "filterCombination": "or", "filters": services},
        {"kind": "group", "filterCombination": "or", "filters": error_markers},
    ]
    payload = {
        "queryId": "github-actions-worker-errors",
        "dry": True,
        "timeframe": {
            "from": int(start.timestamp() * 1000),
            "to": int(end.timestamp() * 1000),
        },
        "parameters": {
            "view": "events",
            "limit": 50,
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


def clean_text(value: Any, limit: int = 180) -> str:
    text = " ".join(str(value or "").replace("|", "\\|").split())
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
    service = metadata.get("service") or workers.get("scriptName") or "unknown"
    timestamp = event.get("timestamp") or metadata.get("timestamp") or "-"
    message = metadata.get("error") or metadata.get("message") or event.get("source") or "error event"
    url = metadata.get("url") or request.get("url") or worker_event.get("url")
    return clean_text(timestamp, 40), clean_text(service, 80), clean_text(message), clean_url(url)


def number(value: Any) -> str:
    if value is None:
        return "-"
    return f"{float(value):.3f}".rstrip("0").rstrip(".")


def main() -> int:
    if not TOKEN or not ACCOUNT_ID or not WORKERS:
        raise RuntimeError("Cloudflare token, account ID, and Worker list are required")
    end = dt.datetime.now(dt.timezone.utc)
    start = end - dt.timedelta(minutes=LOOKBACK_MINUTES)
    metrics = [worker_metrics(ACCOUNT_ID, worker, start, end) for worker in WORKERS]
    errors = telemetry_errors(ACCOUNT_ID, start, end)
    total_errors = sum(item["errors"] for item in metrics)

    lines = [
        "## Cloudflare Observability",
        "",
        f"- Window: `{iso(start)}` to `{iso(end)}`",
        f"- Account: `{ACCOUNT_ID[:8]}…`",
        "- Sources: GraphQL Analytics API and Workers Observability Telemetry API",
        "",
        "| Worker | Requests | Errors | Error rate | Subrequests | CPU p50 ms | CPU p99 ms |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for item in metrics:
        requests = item["requests"]
        rate = (item["errors"] / requests * 100) if requests else 0
        lines.append(
            f"| `{item['worker']}` | {requests} | {item['errors']} | {rate:.2f}% | "
            f"{item['subrequests']} | {number(item['cpu_p50_ms'])} | {number(item['cpu_p99_ms'])} |"
        )

    lines.extend(["", f"### Recent error events ({len(errors)} samples)", ""])
    if errors:
        lines.extend(["| Time | Worker | Error | URL |", "|---|---|---|---|"])
        for event in errors[:10]:
            timestamp, service, message, url = event_row(event)
            lines.append(f"| {timestamp} | `{service}` | {message} | {url} |")
    else:
        lines.append("No matching persisted error events were returned for this window.")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as summary:
            summary.write("\n".join(lines) + "\n")
    else:
        print("\n".join(lines))
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
