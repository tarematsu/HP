"""Collect current Cloudflare D1 database sizes for the observability issue."""

from __future__ import annotations

import glob
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

API = "https://api.cloudflare.com/client/v4"
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
CONFIGS = tuple(
    value.strip()
    for value in os.environ.get("CLOUDFLARE_CONFIG_GLOBS", "").split(",")
    if value.strip()
)
OUT = Path(os.environ.get("FREE_TIER_USAGE_OUTPUT_DIR", "free-tier-usage"))


def configured_d1_databases() -> list[dict[str, Any]]:
    databases: dict[str, dict[str, Any]] = {}
    for pattern in CONFIGS:
        for name in glob.glob(pattern, recursive=True):
            path = Path(name)
            if not path.is_file():
                continue
            try:
                config = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            for row in config.get("d1_databases") or []:
                database_id = str(row.get("database_id") or "").strip().lower()
                if not database_id:
                    continue
                item = databases.setdefault(database_id, {
                    "databaseId": database_id,
                    "configuredName": str(row.get("database_name") or "").strip() or None,
                    "bindings": set(),
                })
                binding = str(row.get("binding") or "").strip()
                if binding:
                    item["bindings"].add(binding)
                configured_name = str(row.get("database_name") or "").strip()
                if configured_name:
                    item["configuredName"] = configured_name
    rows = []
    for item in databases.values():
        rows.append({
            **item,
            "bindings": sorted(item["bindings"]),
        })
    return sorted(rows, key=lambda row: (str(row.get("configuredName") or ""), row["databaseId"]))


def _request_database(database_id: str) -> dict[str, Any]:
    fields = urllib.parse.quote("uuid,name,file_size")
    request = urllib.request.Request(
        f"{API}/accounts/{ACCOUNT}/d1/database/{database_id}?fields={fields}",
        method="GET",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            "User-Agent": "github-actions-cloudflare-observability-d1-storage",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Cloudflare HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Cloudflare request failed: {error.reason}") from error
    if body.get("success") is False or body.get("errors"):
        raise RuntimeError(f"Cloudflare API error: {json.dumps(body.get('errors'))[:500]}")
    result = body.get("result") or {}
    if not isinstance(result, dict):
        raise RuntimeError("Cloudflare D1 database response did not contain an object result")
    return result


def collect_d1_storage(
    configured: list[dict[str, Any]],
    request_database: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    request = request_database or _request_database
    rows = []
    total_bytes = 0
    available = 0
    for database in configured:
        database_id = str(database.get("databaseId") or "")
        try:
            result = request(database_id)
            raw_size = result.get("file_size")
            file_size = int(raw_size) if raw_size is not None else None
            if file_size is not None and file_size < 0:
                file_size = None
            if file_size is not None:
                total_bytes += file_size
                available += 1
            rows.append({
                **database,
                "name": str(result.get("name") or database.get("configuredName") or database_id),
                "fileSize": file_size,
                "error": None if file_size is not None else "file_size missing from Cloudflare response",
            })
        except Exception as error:  # Diagnostic enrichment must not fail the budget gate.
            rows.append({
                **database,
                "name": str(database.get("configuredName") or database_id),
                "fileSize": None,
                "error": str(error)[:500],
            })
    return {
        "databaseCount": len(rows),
        "availableCount": available,
        "totalBytes": total_bytes,
        "databases": rows,
    }


def format_bytes(value: int | None) -> str:
    if value is None:
        return "unavailable"
    if value >= 1_000_000_000:
        return f"{value / 1_000_000_000:.3f} GB"
    if value >= 1_000_000:
        return f"{value / 1_000_000:.2f} MB"
    if value >= 1_000:
        return f"{value / 1_000:.2f} KB"
    return f"{value} B"


def render_d1_storage(storage: dict[str, Any]) -> str:
    rows = storage.get("databases") or []
    lines = [
        "### D1 database storage",
        "",
        "- Source: Cloudflare D1 Database API `file_size` (no SQL query executed)",
        f"- Configured databases: `{storage.get('databaseCount', 0)}` · size available: `{storage.get('availableCount', 0)}`",
        f"- Current configured D1 total: **{format_bytes(int(storage.get('totalBytes') or 0))}** (`{int(storage.get('totalBytes') or 0):,}` bytes)",
        "",
        "| Database | Binding(s) | Current size | Bytes |",
        "|---|---|---:|---:|",
    ]
    for row in rows:
        size = row.get("fileSize")
        bindings = ", ".join(f"`{value}`" for value in row.get("bindings") or []) or "-"
        bytes_text = f"{int(size):,}" if size is not None else "-"
        lines.append(
            f"| `{row.get('name') or row.get('configuredName') or 'unknown'}` | {bindings} | "
            f"{format_bytes(size)} | {bytes_text} |"
        )
        if row.get("error"):
            lines.append(f"<!-- d1-storage-error {row.get('databaseId')}: {str(row['error']).replace('-->', '-- >')} -->")
    if not rows:
        lines.append("| - | - | unavailable | - |")
    return "\n".join(lines) + "\n"


def append_d1_storage_diagnostics() -> dict[str, Any]:
    if not TOKEN or not ACCOUNT or not CONFIGS:
        storage = {
            "databaseCount": 0,
            "availableCount": 0,
            "totalBytes": 0,
            "databases": [],
            "error": "Cloudflare token, account ID, or config globs unavailable",
        }
    else:
        configured = configured_d1_databases()
        storage = collect_d1_storage(configured)
        if not configured:
            storage["error"] = "No configured D1 databases were discovered"

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "d1-storage.json").write_text(json.dumps(storage, indent=2) + "\n", encoding="utf-8")
    markdown = render_d1_storage(storage)
    with (OUT / "summary.md").open("a", encoding="utf-8") as output:
        output.write("\n" + markdown)
    if path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(path, "a", encoding="utf-8") as output:
            output.write("\n" + markdown)

    failures = [row for row in storage.get("databases") or [] if row.get("error")]
    if storage.get("error"):
        print(f"::warning title=D1 storage diagnostics::{storage['error']}")
    if failures:
        print(
            "::warning title=D1 storage diagnostics partial::"
            f"available={storage.get('availableCount', 0)} total={storage.get('databaseCount', 0)}"
        )
    print("D1_STORAGE=" + json.dumps(storage, separators=(",", ":")))
    return storage


def self_test() -> int:
    configured = [
        {"databaseId": "a", "configuredName": "stationhead-buddies", "bindings": ["BUDDIES_DB"]},
        {"databaseId": "b", "configuredName": "stationhead-minute", "bindings": ["MINUTE_DB"]},
    ]

    def fake_request(database_id: str) -> dict[str, Any]:
        if database_id == "a":
            return {"uuid": "a", "name": "stationhead-buddies", "file_size": 123_000_000}
        return {"uuid": "b", "name": "stationhead-minute", "file_size": 45_000_000}

    storage = collect_d1_storage(configured, fake_request)
    assert storage["databaseCount"] == 2
    assert storage["availableCount"] == 2
    assert storage["totalBytes"] == 168_000_000
    markdown = render_d1_storage(storage)
    assert "stationhead-buddies" in markdown
    assert "123.00 MB" in markdown
    assert "168.00 MB" in markdown
    assert "no SQL query executed" in markdown
    print("D1 storage diagnostics self-test passed")
    return 0
