#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: regex did not match exactly once: {pattern[:120]!r}")
    write(path, updated)


audit = ".github/scripts/audit-cloudflare-telemetry.py"
replace_once(
    audit,
    "\n\ndef timestamp_ms(event: dict[str, Any]) -> float:\n",
    '''\n\ndef request_id(event: dict[str, Any]) -> str:\n    metadata, workers = fields(event)\n    return str(metadata.get("requestId") or workers.get("requestId") or "")\n\n\ndef error_priority(event: dict[str, Any]) -> int:\n    metadata, workers = fields(event)\n    source = event.get("source") if isinstance(event.get("source"), dict) else {}\n    outcome = str(workers.get("outcome") or "").lower()\n    level = str(metadata.get("level") or source.get("level") or "").lower()\n    status = finite(metadata.get("statusCode") or workers.get("statusCode"))\n    return (\n        (8 if outcome not in OK_OUTCOMES else 0)\n        + (4 if finite(workers.get("cpuTimeMs")) is not None else 0)\n        + (2 if status is not None and status >= 500 else 0)\n        + (1 if bool(metadata.get("error")) or level in {"error", "fatal"} else 0)\n    )\n\n\ndef timestamp_ms(event: dict[str, Any]) -> float:\n''',
)

replace_regex(
    audit,
    r"def current_events\(.*?\n\ndef evaluate\(",
    '''def current_events(\n    persisted: list[dict[str, Any]],\n    live: list[dict[str, Any]],\n) -> tuple[list[dict[str, Any]], dict[str, str], int]:\n    all_events = merge_events(persisted, live)\n    invocations = [event for event in all_events if detail(event)["cpu_ms"] is not None]\n    latest: dict[str, tuple[float, str]] = {}\n    for event in invocations:\n        worker = worker_name(event)\n        version = version_id(event)\n        if worker not in WORKERS or not version:\n            continue\n        candidate = (timestamp_ms(event), version)\n        if worker not in latest or candidate[0] >= latest[worker][0]:\n            latest[worker] = candidate\n    versions = {worker: value[1] for worker, value in latest.items()}\n\n    selected: list[dict[str, Any]] = []\n    for event in all_events:\n        worker = worker_name(event)\n        if worker not in WORKERS:\n            continue\n        expected = versions.get(worker)\n        observed = version_id(event)\n        if expected and observed and observed != expected:\n            continue\n        selected.append(event)\n    selected_invocations = sum(1 for event in selected if detail(event)["cpu_ms"] is not None)\n    old_versions = len(invocations) - selected_invocations\n    return selected, versions, old_versions\n\n\ndef evaluate(''',
)

replace_regex(
    audit,
    r"def evaluate\(.*?\n\ndef self_test\(",
    '''def evaluate(\n    events: list[dict[str, Any]],\n    truncated: bool,\n) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, list[float]], list[str], bool]:\n    violations: list[dict[str, Any]] = []\n    exempted: list[dict[str, Any]] = []\n    error_items: dict[str, tuple[int, dict[str, Any]]] = {}\n    samples: dict[str, list[float]] = {worker: [] for worker in WORKERS}\n    for event in events:\n        item = detail(event)\n        cpu_ms = item["cpu_ms"]\n        if item["worker"] in samples and cpu_ms is not None:\n            samples[item["worker"]].append(cpu_ms)\n        if error_event(event):\n            key = request_id(event) or event_key(event)\n            priority = error_priority(event)\n            current = error_items.get(key)\n            if current is None or priority > current[0]:\n                error_items[key] = (priority, item)\n        if cpu_ms is None or cpu_ms <= item["budget_ms"]:\n            continue\n        if exempt(event):\n            exempted.append(item)\n        else:\n            violations.append(item)\n    errors = [item for _, item in error_items.values()]\n    missing = [worker for worker, values in samples.items() if not values]\n    return violations, exempted, errors, samples, missing, not truncated and not missing\n\n\ndef self_test(''',
)

replace_regex(
    audit,
    r"def self_test\(\) -> int:.*?\n\ndef main\(",
    '''def self_test() -> int:\n    old = {\n        "timestamp": "2026-07-22T00:00:00Z",\n        "$metadata": {"id": "old", "service": "a", "requestId": "old-request"},\n        "$workers": {"scriptVersion": {"id": "v1"}, "cpuTimeMs": 99, "outcome": "ok"},\n    }\n    persisted_current = {\n        "timestamp": "2026-07-22T01:00:00Z",\n        "$metadata": {"id": "persisted-current", "service": "a", "requestId": "persisted-request"},\n        "$workers": {"scriptVersion": {"id": "v2"}, "cpuTimeMs": 4, "outcome": "ok"},\n    }\n    live_error = {\n        "timestamp": "2026-07-22T01:02:00Z",\n        "$metadata": {"id": "live-error", "service": "a", "requestId": "shared-request"},\n        "$workers": {"scriptVersion": {"id": "v3"}, "cpuTimeMs": 3, "outcome": "exception"},\n        "_diagnostic_source": "live_tail",\n    }\n    live_error_log = {\n        "timestamp": "2026-07-22T01:02:00.100Z",\n        "$metadata": {\n            "id": "live-error-log",\n            "service": "a",\n            "requestId": "shared-request",\n            "level": "error",\n            "error": "duplicate console error",\n        },\n        "$workers": {"scriptVersion": {"id": "v3"}, "outcome": "ok"},\n        "_diagnostic_source": "live_tail",\n    }\n    live_ok = {\n        "timestamp": "2026-07-22T01:03:00Z",\n        "$metadata": {"id": "live-ok", "service": "a", "requestId": "live-ok-request"},\n        "$workers": {"scriptVersion": {"id": "v3"}, "cpuTimeMs": 5, "outcome": "ok"},\n        "_diagnostic_source": "live_tail",\n    }\n    original = globals()["WORKERS"]\n    globals()["WORKERS"] = ("a",)\n    try:\n        selected, versions, excluded = current_events(\n            [old, persisted_current],\n            [live_error, live_error_log, live_ok],\n        )\n        assert versions == {"a": "v3"}\n        assert excluded == 2\n        assert {version_id(event) for event in selected if version_id(event)} == {"v3"}\n        violations, _, errors, samples, missing, coverage = evaluate(selected, False)\n        assert not violations and len(errors) == 1\n        assert errors[0]["outcome"] == "exception"\n        assert samples["a"] == [3.0, 5.0]\n        assert not missing and coverage\n        assert timestamp_ms(live_ok) > timestamp_ms(persisted_current) > timestamp_ms(old)\n    finally:\n        globals()["WORKERS"] = original\n    print("telemetry audit self-test passed")\n    return 0\n\n\ndef main(''',
)

radar = "hp/cloud/src/radar_bundle.ts"
replace_once(
    radar,
    '''interface ShardResponse {\n  response: Response;\n  byteLength: number;\n}\n\ntype FixedWriter = WritableStreamDefaultWriter<Uint8Array>;\n''',
    '''interface ShardResponse {\n  bytes: Uint8Array;\n  byteLength: number;\n}\n''',
)
replace_regex(
    radar,
    r"function fixedLengthStream\(.*?\n\nfunction bundleResponse\(",
    '''function bufferedRecords(records: readonly BufferedRecord[], byteLength: number): Uint8Array {\n  const body = new Uint8Array(byteLength);\n  let offset = 0;\n  for (const record of records) {\n    body.set(record.header, offset);\n    offset += record.header.length;\n    body.set(record.body, offset);\n    offset += record.body.length;\n  }\n  if (offset !== byteLength) throw new Error("radar bundle shard length changed during assembly");\n  return body;\n}\n\nfunction bundleResponse(''',
)
replace_once(
    radar,
    '''    return new Response(recordStream(records, byteLength), {\n      headers: {\n        "Content-Type": "application/octet-stream",\n        "Content-Length": String(byteLength),\n        "X-HomePanel-Radar-Shard-Bytes": String(byteLength),\n      },\n    });\n''',
    '''    return new Response(bufferedRecords(records, byteLength), {\n      headers: {\n        "Content-Type": "application/octet-stream",\n        "Content-Length": String(byteLength),\n        "X-HomePanel-Radar-Shard-Bytes": String(byteLength),\n      },\n    });\n''',
)
replace_regex(
    radar,
    r"async function fetchShardResponse\(.*?\n\nexport async function radarBundleResponseForPayload\(",
    '''async function fetchShardResponse(\n  namespace: DurableObjectNamespace,\n  chunk: string[],\n  index: number,\n): Promise<ShardResponse> {\n  const stub = namespace.get(namespace.idFromName(`radar-bundle-${index}`));\n  const response = await stub.fetch("https://scheduler.internal/radar-bundle-shard", {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify({ paths: chunk }),\n  });\n  if (!response.ok) {\n    await response.body?.cancel();\n    throw new Error(`radar bundle shard ${index} failed: HTTP ${response.status}`);\n  }\n  const byteLength = Number(\n    response.headers.get("X-HomePanel-Radar-Shard-Bytes")\n    ?? response.headers.get("Content-Length"),\n  );\n  const bytes = new Uint8Array(await response.arrayBuffer());\n  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || bytes.length !== byteLength) {\n    throw new Error(`radar bundle shard ${index} length is invalid`);\n  }\n  return { bytes, byteLength };\n}\n\nexport async function radarBundleResponseForPayload(''',
)
replace_once(
    radar,
    '''  const header = bundleHeader(paths.length);\n  const totalBytes = shards.reduce((total, shard) => total + shard.byteLength, header.length);\n  if (totalBytes > MAX_BUNDLE_BYTES) {\n    await Promise.all(shards.map(shard => shard.response.body?.cancel()));\n    console.error("radar bundle exceeded response limit", totalBytes);\n    return Response.json({ error: "radar_bundle_too_large" }, { status: 502 });\n  }\n\n  const response = bundleResponse(\n    shardStream(header, shards.map(shard => shard.response), totalBytes),\n    totalBytes,\n    paths.length,\n  );\n''',
    '''  const header = bundleHeader(paths.length);\n  const totalBytes = shards.reduce((total, shard) => total + shard.byteLength, header.length);\n  if (totalBytes > MAX_BUNDLE_BYTES) {\n    console.error("radar bundle exceeded response limit", totalBytes);\n    return Response.json({ error: "radar_bundle_too_large" }, { status: 502 });\n  }\n\n  const body = new Uint8Array(totalBytes);\n  body.set(header);\n  let offset = header.length;\n  for (const shard of shards) {\n    body.set(shard.bytes, offset);\n    offset += shard.byteLength;\n  }\n  if (offset !== totalBytes) throw new Error("radar bundle length changed during assembly");\n  const response = bundleResponse(body, totalBytes, paths.length);\n''',
)

radar_test = "hp/cloud/test/radar_bundle_connections.test.ts"
replace_once(
    radar_test,
    '''  it("fully drains tile responses with at most four upstream requests active", async () => {''',
    '''  it("fully drains tile responses with at most four upstream requests active", async () => {''',
)
replace_once(
    radar_test,
    '''  });\n});\n''',
    '''  });\n\n  it("builds shard bodies without depending on FixedLengthStream", async () => {\n    vi.stubGlobal("FixedLengthStream", class {\n      constructor() {\n        throw new Error("FixedLengthStream must not be used by radar bundle assembly");\n      }\n    });\n    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {\n      status: 200,\n      headers: { "Content-Type": "image/png" },\n    })));\n\n    const response = await radarBundleShardResponse(new Request(\n      "https://scheduler.internal/radar-bundle-shard",\n      {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ paths: [tilePath(0), tilePath(1)] }),\n      },\n    ), {} as Env);\n\n    const bytes = new Uint8Array(await response.arrayBuffer());\n    expect(response.status).toBe(200);\n    expect(bytes.length).toBe(Number(response.headers.get("Content-Length")));\n    expect(bytes.length).toBe(Number(response.headers.get("X-HomePanel-Radar-Shard-Bytes")));\n  });\n});\n''',
)

contract = "tests/cloudflare-observability-api.test.mjs"
replace_once(
    contract,
    '''const auditScript = readSource('.github/scripts/audit-cloudflare-telemetry.py');\n''',
    '''const auditScript = readSource('.github/scripts/audit-cloudflare-telemetry.py');\nconst auditUrl = new URL('../.github/scripts/audit-cloudflare-telemetry.py', import.meta.url);\n''',
)
replace_once(
    contract,
    '''    'missing_workers',\n    'incomplete coverage',\n''',
    '''    'missing_workers',\n    'request_id',\n    'all_events = merge_events',\n    'error_items',\n    'incomplete coverage',\n''',
)
replace_once(
    contract,
    '''test('D1 query cost collector uses resolved-account GraphQL and passes its privacy self-test', () => {\n''',
    '''test('telemetry audit filters live and persisted events to one version and deduplicates invocation errors', () => {\n  const result = spawnSync('python3', [fileURLToPath(auditUrl), '--self-test'], { encoding: 'utf8' });\n  assert.equal(result.status, 0, `${result.stdout}\\n${result.stderr}`);\n});\n\ntest('D1 query cost collector uses resolved-account GraphQL and passes its privacy self-test', () => {\n''',
)

print("observability and radar bundle fixes applied")
