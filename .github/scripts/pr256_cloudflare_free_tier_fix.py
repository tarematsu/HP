#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        return
    file.write_text(text.replace(old, new), encoding="utf-8")


def insert_after(path: str, marker: str, addition: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if addition.strip() in text:
        return
    if marker not in text:
        raise SystemExit(f"{path}: insertion marker not found: {marker!r}")
    file.write_text(text.replace(marker, marker + addition, 1), encoding="utf-8")


def rename(old: str, new: str) -> None:
    source = Path(old)
    target = Path(new)
    if target.exists():
        return
    if not source.exists():
        raise SystemExit(f"rename source missing: {old}")
    source.rename(target)


rename("scripts/enforce-d1-half-budget.mjs", "scripts/enforce-d1-free-tier-budget.mjs")
rename("scripts/enforce-d1-hourly-half-budget.mjs", "scripts/enforce-d1-hourly-free-tier-budget.mjs")
rename("tests/d1-half-budget-enforcement.test.mjs", "tests/d1-free-tier-budget-enforcement.test.mjs")

free_tier = ".github/scripts/cloudflare_free_tier_audit.py"
for old, new in {
    '"queueOperations": 8_000': '"queueOperations": 10_000',
    '"doRequests": 80_000': '"doRequests": 100_000',
    '"doActiveGbSeconds": 10_400.0': '"doActiveGbSeconds": 13_000.0',
    '"doRowsRead": 4_000_000': '"doRowsRead": 5_000_000',
    '"doRowsWritten": 80_000': '"doRowsWritten": 100_000',
    '"doStoredBytes": 4 * GB': '"doStoredBytes": 5 * GB',
    '"r2ClassAOperations": 800_000': '"r2ClassAOperations": 1_000_000',
    '"r2ClassBOperations": 8_000_000': '"r2ClassBOperations": 10_000_000',
    '"r2StoredBytes": 8 * GB': '"r2StoredBytes": 10 * GB',
    '"kvReads": 80_000': '"kvReads": 100_000',
    '"kvWrites": 800': '"kvWrites": 1_000',
    '"kvDeletes": 800': '"kvDeletes": 1_000',
    '"kvLists": 800': '"kvLists": 1_000',
    '"kvStoredBytes": 800_000_000': '"kvStoredBytes": 1_000_000_000',
    "Account-wide usage capped at 80% of Cloudflare free/no-charge allowances":
        "Account-wide usage capped at 100% of Cloudflare free/no-charge allowances",
    "## Account-wide Cloudflare free-tier 80% budgets":
        "## Account-wide Cloudflare free-tier 100% budgets",
}.items():
    replace(free_tier, old, new)

for path, values in {
    ".github/workflows/sh-observability.yml": {
        'DAILY_REQUEST_BUDGET: "70000"': 'DAILY_REQUEST_BUDGET: "100000"',
        'DAILY_D1_READ_BUDGET: "3000000"': 'DAILY_D1_READ_BUDGET: "5000000"',
        'DAILY_D1_WRITE_BUDGET: "70000"': 'DAILY_D1_WRITE_BUDGET: "100000"',
    },
    ".github/workflows/hp-observability.yml": {
        'DAILY_REQUEST_BUDGET: "3000"': 'DAILY_REQUEST_BUDGET: "100000"',
        'DAILY_D1_READ_BUDGET: "50000"': 'DAILY_D1_READ_BUDGET: "5000000"',
        'DAILY_D1_WRITE_BUDGET: "3000"': 'DAILY_D1_WRITE_BUDGET: "100000"',
        'DAILY_QUEUE_BUDGET: "1000"': 'DAILY_QUEUE_BUDGET: "10000"',
    },
}.items():
    for old, new in values.items():
        replace(path, old, new)
insert_after(
    ".github/workflows/sh-observability.yml",
    '      DAILY_D1_WRITE_BUDGET: "100000"\n',
    '      DAILY_QUEUE_BUDGET: "10000"\n',
)

for path in ("scripts/cloudflare-d1-usage.mjs", "scripts/cloudflare-d1-hourly-usage.mjs"):
    replace(path, "const TARGET_RATIO = 0.5;", "const TARGET_RATIO = 1;")
replace("scripts/cloudflare-d1-usage.mjs", "50% target", "100% target")
replace("scripts/cloudflare-d1-hourly-usage.mjs", "50% free-tier window target", "100% free-tier window target")
replace("scripts/enforce-d1-free-tier-budget.mjs", "const ratio = 0.5;", "const ratio = 1;")
replace("scripts/enforce-d1-free-tier-budget.mjs", "D1 50% free-tier budget exceeded", "D1 100% free-tier budget exceeded")
replace("scripts/enforce-d1-hourly-free-tier-budget.mjs", "numeric(input?.limits?.targetRatio) || 0.5", "numeric(input?.limits?.targetRatio) || 1")
replace("scripts/enforce-d1-hourly-free-tier-budget.mjs", "D1 rolling-window 50% budget exceeded", "D1 rolling-window 100% free-tier budget exceeded")
replace("scripts/enforce-d1-hourly-free-tier-budget.mjs", "D1 rolling-window 50% budget passed", "D1 rolling-window 100% free-tier budget passed")

hourly_test = "scripts/cloudflare-d1-hourly-usage.test.mjs"
for old, new in {
    "const TARGET_RATIO = 0.5;": "const TARGET_RATIO = 1;",
    "50 percent free-tier budget": "100 percent free-tier budget",
    "104_166.66666666667": "208_333.33333333334",
    "2_083.3333333333335": "4_166.666666666667",
}.items():
    replace(hourly_test, old, new)

enforcement_test = "tests/d1-free-tier-budget-enforcement.test.mjs"
for old, new in {
    "../scripts/enforce-d1-half-budget.mjs": "../scripts/enforce-d1-free-tier-budget.mjs",
    "../scripts/enforce-d1-hourly-half-budget.mjs": "../scripts/enforce-d1-hourly-free-tier-budget.mjs",
    "50 percent": "100 percent free-tier ceiling",
    "planningEstimate: { rowsRead: 500, rowsWritten: 49 }": "planningEstimate: { rowsRead: 1_000, rowsWritten: 99 }",
    "planningEstimate: { rowsRead: 499, rowsWritten: 49 }": "planningEstimate: { rowsRead: 999, rowsWritten: 99 }",
    "/rows read 500 >= 500/": "/rows read 1000 >= 1000/",
    "observed: { rowsRead: 500, rowsWritten: 49 }": "observed: { rowsRead: 1_000, rowsWritten: 99 }",
    "observed: { rowsRead: 499, rowsWritten: 49 }": "observed: { rowsRead: 999, rowsWritten: 99 }",
    "limits: { targetPerWindow: { rowsRead: 500, rowsWritten: 50 } }": "limits: { targetPerWindow: { rowsRead: 1_000, rowsWritten: 100 } }",
    "targetRatio: 0.5": "targetRatio: 1",
    "targetPerHour: { rowsRead: 104_166.67, rowsWritten: 2_083.33 }": "targetPerHour: { rowsRead: 208_333.34, rowsWritten: 4_166.67 }",
    "8_680": "17_361",
    "2_083": "4_166",
    "/rows read 2300000 >= 8680/": "/rows read 2300000 >= 17361/",
    "rowsWritten: 2_084": "rowsWritten: 4_167",
    "/rows written 2084 >= 2083/": "/rows written 4167 >= 4166/",
}.items():
    replace(enforcement_test, old, new)

free_tier_test = "tests/cloudflare-free-tier-budgets.test.mjs"
for old, new in {
    "fixed at 80 percent of included usage": "fixed at 100 percent of included usage",
    "Account-wide Cloudflare free-tier 80% budgets": "Account-wide Cloudflare free-tier 100% budgets",
    '"queueOperations": 8_000': '"queueOperations": 10_000',
    '"doRequests": 80_000': '"doRequests": 100_000',
    '"doActiveGbSeconds": 10_400.0': '"doActiveGbSeconds": 13_000.0',
    '"doRowsRead": 4_000_000': '"doRowsRead": 5_000_000',
    '"doRowsWritten": 80_000': '"doRowsWritten": 100_000',
    '"doStoredBytes": 4 * GB': '"doStoredBytes": 5 * GB',
    '"r2ClassAOperations": 800_000': '"r2ClassAOperations": 1_000_000',
    '"r2ClassBOperations": 8_000_000': '"r2ClassBOperations": 10_000_000',
    '"r2StoredBytes": 8 * GB': '"r2StoredBytes": 10 * GB',
    '"kvReads": 80_000': '"kvReads": 100_000',
    '"kvWrites": 800': '"kvWrites": 1_000',
    '"kvDeletes": 800': '"kvDeletes": 1_000',
    '"kvLists": 800': '"kvLists": 1_000',
    '"kvStoredBytes": 800_000_000': '"kvStoredBytes": 1_000_000_000',
    "maximumCoordinatorRequests < 80_000": "maximumCoordinatorRequests < 100_000",
    "maximumCoordinatorDuration < 10_400": "maximumCoordinatorDuration < 13_000",
    "maximumCoordinatorRowsRead < 4_000_000": "maximumCoordinatorRowsRead < 5_000_000",
    "maximumCoordinatorRowsWritten < 80_000": "maximumCoordinatorRowsWritten < 100_000",
    "maximumQueueOperations < 8_000": "maximumQueueOperations < 10_000",
    "maximumDailyKvWrites < 800": "maximumDailyKvWrites < 1_000",
    "maximumMonthlyR2Mirrors + maximumMonthlyQueuePlanClassA < 800_000": "maximumMonthlyR2Mirrors + maximumMonthlyQueuePlanClassA < 1_000_000",
    "maximumMonthlyQueuePlanReads < 8_000_000": "maximumMonthlyQueuePlanReads < 10_000_000",
}.items():
    replace(free_tier_test, old, new)
replace("tests/cloudflare-runtime-relay-budget.test.mjs", "< 8_000", "< 10_000")

for path, values in {
    "tests/cloudflare-observability-budgets.test.mjs": {
        'DAILY_REQUEST_BUDGET: "70000"': 'DAILY_REQUEST_BUDGET: "100000"',
        'DAILY_D1_READ_BUDGET: "3000000"': 'DAILY_D1_READ_BUDGET: "5000000"',
        'DAILY_D1_WRITE_BUDGET: "70000"': 'DAILY_D1_WRITE_BUDGET: "100000"',
    },
    "tests/homepanel-observability-contract.test.mjs": {
        'DAILY_REQUEST_BUDGET: "3000"': 'DAILY_REQUEST_BUDGET: "100000"',
        'DAILY_D1_READ_BUDGET: "50000"': 'DAILY_D1_READ_BUDGET: "5000000"',
        'DAILY_D1_WRITE_BUDGET: "3000"': 'DAILY_D1_WRITE_BUDGET: "100000"',
        'DAILY_QUEUE_BUDGET: "1000"': 'DAILY_QUEUE_BUDGET: "10000"',
    },
    "tests/ci-workflow-efficiency.test.mjs": {
        'DAILY_REQUEST_BUDGET: "70000"': 'DAILY_REQUEST_BUDGET: "100000"',
        'DAILY_D1_READ_BUDGET: "3000000"': 'DAILY_D1_READ_BUDGET: "5000000"',
        'DAILY_D1_WRITE_BUDGET: "70000"': 'DAILY_D1_WRITE_BUDGET: "100000"',
    },
    "tests/d1-budget-regressions.test.mjs": {
        'DAILY_REQUEST_BUDGET: "70000"': 'DAILY_REQUEST_BUDGET: "100000"',
        'DAILY_D1_READ_BUDGET: "3000000"': 'DAILY_D1_READ_BUDGET: "5000000"',
        'DAILY_D1_WRITE_BUDGET: "70000"': 'DAILY_D1_WRITE_BUDGET: "100000"',
    },
}.items():
    for old, new in values.items():
        replace(path, old, new)
insert_after("tests/cloudflare-observability-budgets.test.mjs", "    'DAILY_D1_WRITE_BUDGET: \"100000\"',\n", "    'DAILY_QUEUE_BUDGET: \"10000\"',\n")
insert_after("tests/ci-workflow-efficiency.test.mjs", '  assert.match(observability, /DAILY_D1_WRITE_BUDGET: "100000"/);\n', '  assert.match(observability, /DAILY_QUEUE_BUDGET: "10000"/);\n')
insert_after("tests/d1-budget-regressions.test.mjs", '  assert.match(workflow, /DAILY_D1_WRITE_BUDGET: "100000"/);\n', '  assert.match(workflow, /DAILY_QUEUE_BUDGET: "10000"/);\n')
replace("tests/d1-budget-regressions.test.mjs", "measured daily budgets target the required reductions from the current estimate", "measured daily budgets use the full Cloudflare free-tier ceilings")
replace("tests/d1-budget-regressions.test.mjs", "  const currentEstimate = { reads: 8_000_000, writes: 250_000 };\n  const budget = { reads: 3_000_000, writes: 70_000 };\n\n  assert.equal(1 - budget.reads / currentEstimate.reads, 0.625);\n  assert.equal(1 - budget.writes / currentEstimate.writes, 0.72);", "  const budget = { requests: 100_000, reads: 5_000_000, writes: 100_000, queueOperations: 10_000 };\n\n  assert.deepEqual(budget, { requests: 100_000, reads: 5_000_000, writes: 100_000, queueOperations: 10_000 });")

storage = "scripts/cloudflare-d1-storage-audit.mjs"
replace(storage, "const wranglerScript = path.resolve('worker/node_modules/wrangler/bin/wrangler.js');", "const wranglerScript = path.resolve('worker/node_modules/wrangler/bin/wrangler.js');\nconst D1_DATABASE_LIMIT_BYTES = 500_000_000;")
replace(storage, "if (!database) throw new Error(`Wrangler did not list ${databaseName} (${databaseId})`);", "if (!database) throw new Error(`Wrangler did not list ${databaseName} (${databaseId})`);\nconst databaseFileSize = Number(database.file_size);\nif (!Number.isFinite(databaseFileSize) || databaseFileSize < 0) {\n  throw new Error(`Wrangler did not report a valid file_size for ${databaseName}`);\n}\nconst capacityExceeded = databaseFileSize >= D1_DATABASE_LIMIT_BYTES;")
replace(storage, "  queryRowsRead,\n  probes,", "  queryRowsRead,\n  capacity: {\n    limitBytes: D1_DATABASE_LIMIT_BYTES,\n    fileSizeBytes: databaseFileSize,\n    utilizationPercent: (databaseFileSize / D1_DATABASE_LIMIT_BYTES) * 100,\n    exceeded: capacityExceeded,\n  },\n  probes,")
replace(storage, "  `- Cloudflare file size: ${formatBytes(database.file_size)}`,", "  `- Cloudflare file size: ${formatBytes(databaseFileSize)}`,\n  `- Per-database capacity limit: ${formatBytes(D1_DATABASE_LIMIT_BYTES)}`,\n  `- Capacity utilization: ${report.capacity.utilizationPercent.toFixed(2)}%`,\n  `- Capacity result: ${capacityExceeded ? 'FAIL' : 'PASS'}`,")
replace(storage, "  fileSize: database.file_size,", "  fileSize: databaseFileSize,\n  capacityLimitBytes: D1_DATABASE_LIMIT_BYTES,\n  capacityExceeded,")
replace(storage, "  sqliteStat1Available: statRows.length > 0,\n}));", "  sqliteStat1Available: statRows.length > 0,\n}));\nif (capacityExceeded) {\n  console.error(`D1 database capacity exceeded: ${databaseName} ${databaseFileSize} >= ${D1_DATABASE_LIMIT_BYTES} bytes`);\n  process.exitCode = 1;\n}")
insert_after("tests/d1-storage-audit.test.mjs", "  assert.match(script, /wrangler\\(\\['d1', 'list', '--json'\\]\\)/);\n", "  assert.match(script, /D1_DATABASE_LIMIT_BYTES = 500_000_000/);\n  assert.match(script, /databaseFileSize >= D1_DATABASE_LIMIT_BYTES/);\n  assert.match(script, /Per-database capacity limit/);\n  assert.match(script, /process\\.exitCode = 1/);\n")

print("PR256 Cloudflare free-tier policy patch applied")
