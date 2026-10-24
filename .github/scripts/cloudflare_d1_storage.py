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
ZERO_UUID = "00000000-0000-0000-0000-000000000000"
UUID_RE = __import__("re").compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", __import__("re").I)


def is_placeholder_database_id(value: str) -> bool:
    return str(value or "").strip().lower() == ZERO_UUID


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
                configured_name = str(row.get("database_name") or "").strip()
                if not database_id and not configured_name:
                    continue
                key = configured_name or database_id
                item = databases.setdefault(key, {
                    "databaseId": database_id,
                    "configuredName": configured_name or None,
                    "bindings": set(),
                })
                existing_id = str(item.get("databaseId") or "")
                if database_id and existing_id and not is_placeholder_database_id(database_id) and not is_placeholder_database_id(existing_id) and database_id != existing_id:
                    raise RuntimeError(f"Conflicting D1 IDs configured for {configured_name or key}")
                if database_id and (not existing_id or is_placeholder_database_id(existing_id)):
                    item["databaseId"] = database_id
                binding = str(row.get("binding") or "").strip()
                if binding:
                    item["bindings"].add(binding)
                if configured_name:
                    item["configuredName"] = configured_name
    rows = [
        {**item, "bindings": sorted(item["bindings"])}
        for item in databases.values()
    ]
    return sorted(rows, key=lambda row: (str(row.get("configuredName") or ""), row["databaseId"]))


def _request_database(database_id: str) -> dict[str, Any]:
    query = urllib.parse.urlencode({"fields": "uuid,name,file_size"})
    request = urllib.request.Request(
        f"{API}/accounts/{ACCOUNT}/d1/database/{database_id}?{query}",
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


def _request_database_by_name(database_name: str) -> dict[str, Any]:
    query = urllib.parse.urlencode({"name": database_name, "per_page": 100})
    request = urllib.request.Request(
        f"{API}/accounts/{ACCOUNT}/d1/database?{query}",
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
        raise RuntimeError(f"Cloudflare D1 name lookup HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Cloudflare D1 name lookup failed: {error.reason}") from error
    if body.get("success") is False or body.get("errors"):
        raise RuntimeError(f"Cloudflare D1 name lookup error: {json.dumps(body.get('errors'))[:500]}")
    rows = body.get("result") or []
    matches = [
        row for row in rows
        if isinstance(row, dict) and str(row.get("name") or "") == database_name
    ]
    if len(matches) != 1:
        raise RuntimeError(f"Expected exactly one Cloudflare D1 database named {database_name}, found {len(matches)}")
    return matches[0]


def collect_d1_storage(
    configured: list[dict[str, Any]],
    request_database: Callable[[str], dict[str, Any]] | None = None,
    request_database_by_name: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    request = request_database or _request_database
    request_by_name = request_database_by_name or _request_database_by_name
    rows: list[dict[str, Any]] = []
    total_bytes = 0
    available = 0
    for database in configured:
        database_id = str(database.get("databaseId") or "").strip().lower()
        configured_name = str(database.get("configuredName") or "").strip()
        try:
            if is_placeholder_database_id(database_id) or not database_id:
                if not configured_name:
                    raise RuntimeError("Placeholder D1 database ID has no configured database name")
                result = request_by_name(configured_name)
                resolved_id = str(result.get("uuid") or result.get("id") or result.get("database_id") or "").strip().lower()
                if not UUID_RE.fullmatch(resolved_id) or is_placeholder_database_id(resolved_id):
                    raise RuntimeError(f"Cloudflare did not return a valid D1 database ID for {configured_name}")
            else:
                result = request(database_id)
                resolved_id = str(result.get("uuid") or result.get("id") or result.get("database_id") or database_id).strip().lower()
            result_name = str(result.get("name") or configured_name or resolved_id)
            if configured_name and result_name != configured_name:
                raise RuntimeError(f"Configured D1 database {configured_name} resolved to unexpected name {result_name}")
            raw_size = result.get("file_size")
            file_size = int(raw_size) if raw_size is not None else None
            if file_size is not None and file_size < 0:
                file_size = None
            if file_size is not None:
                total_bytes += file_size
                available += 1
            rows.append({
                **database,
                "databaseId": resolved_id,
                "name": result_name,
                "fileSize": file_size,
                "error": None if file_size is not None else "file_size missing from Cloudflare response",
            })
        except Exception as error:  # Coverage is surfaced separately and fails the observability budget step.
            rows.append({
                **database,
                "name": configured_name or database_id,
                "fileSize": None,
                "error": str(error)[:500],
            })
    database_count = len(rows)
    return {
        "databaseCount": database_count,
        "availableCount": available,
        "complete": database_count > 0 and available == database_count,
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


def _total_line(storage: dict[str, Any]) -> str:
    database_count = int(storage.get("databaseCount") or 0)
    available = int(storage.get("availableCount") or 0)
    total_bytes = int(storage.get("totalBytes") or 0)
    if storage.get("complete"):
        return (
            f"- Current configured D1 total: **{format_bytes(total_bytes)}** "
            f"(`{total_bytes:,}` bytes)"
        )
    if available > 0:
        return (
            f"- Available-size subtotal: **{format_bytes(total_bytes)}** (`{total_bytes:,}` bytes); "
            f"full configured D1 total: **unavailable** ({available}/{database_count} sizes fetched)"
        )
    return "- Current configured D1 total: **unavailable**"


def render_d1_storage(storage: dict[str, Any]) -> str:
    rows = storage.get("databases") or []
    lines = [
        "### D1 database storage",
        "",
        "- Source: Cloudflare D1 Database API `file_size` (no SQL query executed)",
        f"- Configured databases: `{storage.get('databaseCount', 0)}` · size available: `{storage.get('availableCount', 0)}`",
        _total_line(storage),
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
    if not rows:
        lines.append("| - | - | unavailable | - |")
    return "\n".join(lines) + "\n"


def append_d1_storage_diagnostics() -> dict[str, Any]:
    if not TOKEN or not ACCOUNT or not CONFIGS:
        storage = {
            "databaseCount": 0,
            "availableCount": 0,
            "complete": False,
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
    assert storage["complete"] is True
    assert storage["totalBytes"] == 168_000_000
    markdown = render_d1_storage(storage)
    assert "Current configured D1 total: **168.00 MB**" in markdown
    assert "stationhead-buddies" in markdown
    assert "no SQL query executed" in markdown

    placeholder = [{
        "databaseId": ZERO_UUID,
        "configuredName": "stationhead-ohisama",
        "bindings": ["OHISAMA_DB"],
    }]

    def fake_name_lookup(database_name: str) -> dict[str, Any]:
        assert database_name == "stationhead-ohisama"
        return {
            "uuid": "9b2b4d61-2d73-4e12-9d23-0b0d9d6f1a42",
            "name": database_name,
            "file_size": 7_000_000,
        }

    resolved = collect_d1_storage(
        placeholder,
        request_database=fake_request,
        request_database_by_name=fake_name_lookup,
    )
    assert resolved["complete"] is True
    assert resolved["availableCount"] == 1
    assert resolved["databases"][0]["databaseId"] == "9b2b4d61-2d73-4e12-9d23-0b0d9d6f1a42"
    assert resolved["totalBytes"] == 7_000_000

    def partial_request(database_id: str) -> dict[str, Any]:
        if database_id == "a":
            return {"uuid": "a", "name": "stationhead-buddies", "file_size": 123_000_000}
        raise RuntimeError("simulated lookup failure")

    partial = collect_d1_storage(configured, partial_request)
    assert partial["complete"] is False
    partial_markdown = render_d1_storage(partial)
    assert "Available-size subtotal: **123.00 MB**" in partial_markdown
    assert "full configured D1 total: **unavailable** (1/2 sizes fetched)" in partial_markdown
    assert "Current configured D1 total: **123.00 MB**" not in partial_markdown

    unavailable = render_d1_storage({
        "databaseCount": 0,
        "availableCount": 0,
        "complete": False,
        "totalBytes": 0,
        "databases": [],
    })
    assert "Current configured D1 total: **unavailable**" in unavailable
    assert "Current configured D1 total: **0 B**" not in unavailable
    print("D1 storage diagnostics self-test passed")
    return 0
