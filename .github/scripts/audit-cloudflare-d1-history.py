#!/usr/bin/env python3
"""Collect configured D1 rows read and written by UTC day."""

from __future__ import annotations

import datetime as dt
import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

API = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
CONFIGS = tuple(x.strip() for x in os.environ.get("D1_CONFIG_GLOBS", "").split(",") if x.strip())
OUT = Path(os.environ.get("DAILY_USAGE_OUTPUT_DIR", "daily-usage"))
DAYS = max(1, min(31, int(os.environ.get("D1_HISTORY_DAYS", "7"))))
DB_RE = re.compile(r'"database_id"\s*:\s*"([0-9a-fA-F-]{36})"')


def api(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, separators=(",", ":")).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "github-actions-cloudflare-d1-history",
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


def configured_database_ids() -> set[str]:
    database_ids: set[str] = set()
    files = 0
    for pattern in CONFIGS:
        for name in glob.glob(pattern, recursive=True):
            path = Path(name)
            if not path.is_file():
                continue
            files += 1
            database_ids.update(match.group(1).lower() for match in DB_RE.finditer(path.read_text(errors="replace")))
    if not files or not database_ids:
        raise RuntimeError("D1_CONFIG_GLOBS did not resolve any database_id")
    return database_ids


def document() -> str:
    return """query D1DailyHistory($account: string, $start: Date!, $end: Date!) {
      viewer { accounts(filter: {accountTag: $account}) {
        d1: d1AnalyticsAdaptiveGroups(
          limit: 10000,
          filter: {date_geq: $start, date_leq: $end},
          orderBy: [date_ASC]
        ) {
          sum { rowsRead rowsWritten }
          dimensions { date databaseId }
        }
      } }
    }"""


def number(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0


def aggregate(groups: list[dict[str, Any]], database_ids: set[str], start: dt.date, days: int) -> list[dict[str, Any]]:
    totals = {
        (start + dt.timedelta(days=offset)).isoformat(): {"rowsRead": 0, "rowsWritten": 0}
        for offset in range(days)
    }
    for group in groups:
        dimensions = group.get("dimensions") or {}
        database_id = str(dimensions.get("databaseId") or "").lower()
        date = str(dimensions.get("date") or "")[:10]
        if database_id not in database_ids or date not in totals:
            continue
        sums = group.get("sum") or {}
        totals[date]["rowsRead"] += number(sums.get("rowsRead"))
        totals[date]["rowsWritten"] += number(sums.get("rowsWritten"))
    return [
        {"date": date, **totals[date]}
        for date in sorted(totals)
    ]


def render(rows: list[dict[str, Any]], today: str) -> str:
    lines = [
        "### D1 UTC daily history", "",
        f"- Window: `{rows[0]['date']}` to `{rows[-1]['date']}`",
        "- Scope: configured D1 databases, account-wide analytics", "",
        "| UTC date | D1 rows read | D1 rows written | Coverage |",
        "|---|---:|---:|---|",
    ]
    for row in rows:
        coverage = "partial day" if row["date"] == today else "complete day"
        lines.append(
            f"| {row['date']} | {row['rowsRead']:,} | {row['rowsWritten']:,} | {coverage} |"
        )
    return "\n".join(lines) + "\n"


def self_test() -> int:
    assert "dimensions { date databaseId }" in document()
    rows = aggregate([
        {"dimensions": {"date": "2026-07-30", "databaseId": "a"}, "sum": {"rowsRead": 10, "rowsWritten": 3}},
        {"dimensions": {"date": "2026-07-30", "databaseId": "b"}, "sum": {"rowsRead": 20, "rowsWritten": 4}},
        {"dimensions": {"date": "2026-07-31", "databaseId": "other"}, "sum": {"rowsRead": 999, "rowsWritten": 999}},
    ], {"a", "b"}, dt.date(2026, 7, 30), 3)
    assert rows == [
        {"date": "2026-07-30", "rowsRead": 30, "rowsWritten": 7},
        {"date": "2026-07-31", "rowsRead": 0, "rowsWritten": 0},
        {"date": "2026-08-01", "rowsRead": 0, "rowsWritten": 0},
    ]
    summary = render(rows, "2026-08-01")
    assert "| 2026-07-30 | 30 | 7 | complete day |" in summary
    assert "| 2026-08-01 | 0 | 0 | partial day |" in summary
    print("D1 daily history self-test passed")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    if not TOKEN or not ACCOUNT or not CONFIGS:
        raise RuntimeError("Cloudflare token, account ID, and D1 config globs are required")

    database_ids = configured_database_ids()
    now = dt.datetime.now(dt.timezone.utc)
    end = now.date()
    start = end - dt.timedelta(days=DAYS - 1)
    body = api(f"{API}/graphql", {
        "query": document(),
        "variables": {
            "account": ACCOUNT,
            "start": start.isoformat(),
            "end": end.isoformat(),
        },
    })
    accounts = (((body.get("data") or {}).get("viewer") or {}).get("accounts") or [])
    if len(accounts) != 1:
        raise RuntimeError(f"Expected one GraphQL account row, got {len(accounts)}")
    rows = aggregate(accounts[0].get("d1") or [], database_ids, start, DAYS)
    report = {
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "timezone": "UTC",
        "databaseCount": len(database_ids),
        "days": rows,
        "source": "Cloudflare GraphQL d1AnalyticsAdaptiveGroups grouped by date and databaseId",
    }
    summary = render(rows, end.isoformat())
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "d1-history.json").write_text(json.dumps(report, indent=2) + "\n")
    (OUT / "d1-history.md").write_text(summary)
    summary_path = OUT / "summary.md"
    if summary_path.exists():
        with summary_path.open("a", encoding="utf-8") as output:
            output.write("\n" + summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
            output.write(summary)
    print("D1_DAILY_HISTORY=" + json.dumps(report, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"::error title=Cloudflare D1 daily history::{str(error).replace(chr(10), ' ')[:1000]}")
        raise
