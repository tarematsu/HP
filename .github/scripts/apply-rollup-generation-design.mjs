import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const path = 'worker/src/rollup-maintenance.js';
let source = readFileSync(path, 'utf8');

function replace(from, to) {
  if (!source.includes(from)) throw new Error(`missing pattern: ${from.slice(0, 80)}`);
  source = source.replace(from, to);
}

replace(
  "async function rollupFromDaily(otherDb, table, range, now) {",
  "async function rollupFromDaily(otherDb, table, range, now, qualityFlags = '[\"live_rollup\"]') {",
);
replace(
  "return upsertSummary(otherDb, table, range.key, aggregate, boundaries, now);",
  "return upsertSummary(otherDb, table, range.key, aggregate, boundaries, now, qualityFlags);",
);
replace(
  `function summaryGeneration(summary) {
  const flags = String(summary?.quality_flags || '');
  const match = flags.match(/minute_generation:([^"\\]]+)/);
  return match?.[1] || null;
}`,
  `function taggedGeneration(summary, tag = 'minute_generation') {
  const flags = String(summary?.quality_flags || '');
  const match = flags.match(new RegExp(tag + ':([^"\\\\]]+)'));
  return match?.[1] || null;
}

function summaryGeneration(summary) {
  return taggedGeneration(summary, 'minute_generation');
}

function rangeGeneration(rows, tag = 'minute_generation') {
  let hash = 2166136261;
  for (const row of rows) {
    const value = row.period_key + ':' + (taggedGeneration(row, tag) || 'missing');
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return rows.length + ':' + hash.toString(16).padStart(8, '0');
}

async function loadRangeGenerations(otherDb, range) {
  const result = await otherDb.prepare(\`SELECT period_key,quality_flags FROM sh_daily_summary
    WHERE period_key>=? AND period_key<? ORDER BY period_key ASC\`)
    .bind(range.startKey, range.endKey).all();
  return result.results || [];
}

async function persistReconcileState(db, period, reconciliation, now) {
  const status = reconciliation.complete
    ? 'complete:' + reconciliation.generation
    : 'dirty:' + (reconciliation.reason || 'incomplete') + ':' + reconciliation.generation;
  await db.prepare(\`INSERT INTO sh_data_maintenance_state(
      id,last_rollup_key,last_cleanup_at,legacy_backfill_id,updated_at
    ) VALUES(?,?,0,0,?) ON CONFLICT(id) DO UPDATE SET
      last_rollup_key=excluded.last_rollup_key,updated_at=excluded.updated_at\`)
    .bind('minute-day:' + period.key, status, now).run();
}

async function persistentDirtyPeriods(db, now, limit = 3) {
  const result = await db.prepare(\`SELECT id FROM sh_data_maintenance_state
    WHERE id LIKE 'minute-day:%' AND last_rollup_key LIKE 'dirty:%'
    ORDER BY updated_at ASC LIMIT ?\`).bind(limit).all();
  const currentDay = Math.floor(now / DAY_MS) * DAY_MS;
  return (result.results || []).map((row) => {
    const key = String(row.id).slice('minute-day:'.length);
    const start = utcDayStart(key);
    return { key, start, end: start + DAY_MS };
  }).filter((period) => period.end <= currentDay);
}

function mergePeriods(primary, secondary, limit = 6) {
  const byKey = new Map();
  for (const period of [...primary, ...secondary]) {
    if (!byKey.has(period.key)) byKey.set(period.key, period);
    if (byKey.size >= limit) break;
  }
  return [...byKey.values()];
}`,
);

source = source.replace(
  /async function refreshWeekly\([\s\S]*?\n}\n\nasync function completeWeeklyCoverage/,
  `async function refreshWeekly(otherDb, range, now, force = false) {
  const existing = await loadSummary(otherDb, 'sh_weekly_summary', range.key);
  const dailyRows = await loadRangeGenerations(otherDb, range);
  const expectedDays = Math.round((range.end - range.start) / DAY_MS);
  if (dailyRows.length !== expectedDays) {
    return { skipped: true, reason: 'daily-summaries-incomplete', periodKey: range.key };
  }
  const generation = rangeGeneration(dailyRows);
  if (existing && !force && taggedGeneration(existing, 'daily_generation') === generation) {
    return { skipped: true, reason: 'already-current', periodKey: range.key, generation };
  }
  const qualityFlags = JSON.stringify(['weekly_reconciled', 'daily_generation:' + generation]);
  const written = await rollupFromDaily(otherDb, 'sh_weekly_summary', range, now, qualityFlags);
  return { skipped: !written, rebuilt: Boolean(existing && written), generated: Boolean(!existing && written), reason: written ? null : 'daily-summaries-empty', periodKey: range.key, generation };
}

async function completeWeeklyCoverage`,
);

source = source.replace(
  /async function refreshMonthly\([\s\S]*?\n}\n\n\/\/ Maintenance state/,
  `async function refreshMonthly(otherDb, range, now, force = false) {
  const existing = await loadSummary(otherDb, 'sh_monthly_summary', range.key);
  if (!(await completeWeeklyCoverage(otherDb, range))) {
    return { skipped: true, reason: 'weekly-summaries-incomplete', periodKey: range.key };
  }
  const dailyRows = await loadRangeGenerations(otherDb, range);
  const expectedDays = Math.round((range.end - range.start) / DAY_MS);
  if (dailyRows.length !== expectedDays) {
    return { skipped: true, reason: 'daily-summaries-incomplete', periodKey: range.key };
  }
  const generation = rangeGeneration(dailyRows);
  if (existing && !force && taggedGeneration(existing, 'daily_generation') === generation) {
    return { skipped: true, reason: 'already-current', periodKey: range.key, generation };
  }
  const qualityFlags = JSON.stringify(['monthly_reconciled', 'daily_generation:' + generation]);
  const written = await rollupFromDaily(otherDb, 'sh_monthly_summary', range, now, qualityFlags);
  return { skipped: !written, rebuilt: Boolean(existing && written), generated: Boolean(!existing && written), reason: written ? null : 'daily-summaries-empty', periodKey: range.key, generation };
}

// Maintenance state`,
);

replace(
  "  const periods = minuteFactReconcileCandidates(now);",
  "  const dirtyPeriods = await persistentDirtyPeriods(db, now);\n  const periods = mergePeriods(dirtyPeriods, minuteFactReconcileCandidates(now));",
);
replace(
  `    if (!reconciliation.complete) {
      results.push({ periodKey: period.key, reconciliation, skipped: true });
      continue;
    }`,
  `    await persistReconcileState(db, period, reconciliation, now);
    if (!reconciliation.complete) {
      results.push({ periodKey: period.key, reconciliation, skipped: true });
      continue;
    }`,
);
replace(
  `    await db.prepare('INSERT INTO sh_data_maintenance_state(id,last_rollup_key,last_cleanup_at,legacy_backfill_id,updated_at) VALUES(?,?,0,0,?) ON CONFLICT(id) DO UPDATE SET last_rollup_key=excluded.last_rollup_key,updated_at=excluded.updated_at')
      .bind('minute-day:' + period.key, reconciliation.generation, now).run();
`,
  '',
);

writeFileSync(path, source);

const testPath = 'tests/immutable-summary-rollups.test.mjs';
let testSource = readFileSync(testPath, 'utf8');
testSource += `\n\ntest('dirty days persist and aggregate generations propagate to dependent summaries', () => {
  assert.match(rollup, /persistentDirtyPeriods/);
  assert.match(rollup, /last_rollup_key LIKE 'dirty:%'/);
  assert.match(rollup, /persistReconcileState/);
  assert.match(rollup, /daily_generation:/);
  assert.match(rollup, /rangeGeneration\\(dailyRows\\)/);
});\n`;
writeFileSync(testPath, testSource);

unlinkSync('.github/scripts/apply-rollup-generation-design.mjs');
unlinkSync('.github/workflows/apply-rollup-generation-design.yml');
