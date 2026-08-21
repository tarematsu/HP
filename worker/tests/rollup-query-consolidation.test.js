import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/rollup-maintenance.js', import.meta.url), 'utf8');

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0, `${start} section is missing`);
  assert.ok(to > from, `${end} section is missing`);
  return source.slice(from, to);
}

function assertSharedRangeParameters(sql) {
  assert.equal((sql.match(/\?1/g) || []).length, 5);
  assert.equal((sql.match(/\?2/g) || []).length, 5);
  assert.doesNotMatch(sql, /\?(?![12])/);
}

test('daily rollups dedupe each channel to one row per minute and select one channel', () => {
  const cte = section('const DAILY_MINUTE_ROWS_CTE', 'const DAILY_BOUNDARIES_SQL');
  assert.equal((cte.match(/\?1/g) || []).length, 1);
  assert.equal((cte.match(/\?2/g) || []).length, 1);
  assert.match(cte, /PARTITION BY snapshots\.channel_id,CAST\(snapshots\.observed_at\/60000 AS INTEGER\)/);
  assert.match(cte, /WHERE minute_rank=1/);
  assert.match(cte, /selected_channel/);
  assert.match(cte, /ORDER BY COUNT\(\*\) DESC,MAX\(observed_at\) DESC,channel_id ASC/);

  const boundaries = section('const DAILY_BOUNDARIES_SQL', 'const SUMMARY_BOUNDARIES_SQL');
  assert.match(boundaries, /\$\{DAILY_MINUTE_ROWS_CTE\}/);
  assert.equal((boundaries.match(/channel_id=\(SELECT channel_id FROM selected_channel\)/g) || []).length, 5);
  assert.match(boundaries, /AS stream_start/);
  assert.match(boundaries, /AS stream_end/);
  assert.match(boundaries, /AS member_start/);
  assert.match(boundaries, /AS member_end/);
  assert.match(boundaries, /AS primary_host/);

  const daily = section('async function rollupDaily', 'async function rollupFromDaily');
  assert.match(daily, /FROM daily_minute_rows/);
  assert.match(daily, /GROUP BY channel_id/);
  assert.equal((daily.match(/\.bind\(period\.start, period\.end\)\.first\(\)/g) || []).length, 2);
  assert.match(daily, /validateSummaryCounts\('sh_daily_summary', aggregate\)/);
});

test('weekly and monthly boundary SQL reuses the same two numbered parameters', () => {
  const sql = section('const SUMMARY_BOUNDARIES_SQL', 'function finite');
  assertSharedRangeParameters(sql);
  assert.match(sql, /AS stream_start/);
  assert.match(sql, /AS stream_end/);
  assert.match(sql, /AS member_start/);
  assert.match(sql, /AS member_end/);
  assert.match(sql, /AS primary_host/);

  const fromDaily = section('async function rollupFromDaily', 'function utcPeriod');
  assert.equal((fromDaily.match(/prepare\(SUMMARY_BOUNDARIES_SQL\)/g) || []).length, 1);
  assert.match(fromDaily, /\.bind\(range\.startKey, range\.endKey\)\.first\(\)/);
  assert.doesNotMatch(fromDaily, /range\.startKey, range\.endKey,\s*range\.startKey/);
});

test('daily summary upserts enforce the 1440 sample invariant', () => {
  const validation = section('function dailySummaryCountsValid', 'async function upsertSummary');
  assert.match(validation, /MAX_DAILY_MINUTE_SAMPLES/);
  assert.match(validation, /reliableSampleCount <= sampleCount/);
  assert.match(validation, /table !== 'sh_daily_summary'/);

  const upsert = section('async function upsertSummary', 'async function rollupDaily');
  assert.match(
    upsert,
    /async function upsertSummary\(db, table, key, aggregate, boundaries, updatedAt, qualityFlags/,
  );
  assert.match(upsert, /validateSummaryCounts\(table, aggregate\)/);
  assert.match(upsert, /finite\(boundaries\?\.stream_start\)/);
  assert.match(upsert, /finite\(boundaries\?\.stream_end\)/);
  assert.match(upsert, /finite\(boundaries\?\.member_start\)/);
  assert.match(upsert, /finite\(boundaries\?\.member_end\)/);
  assert.match(upsert, /boundaries\?\.primary_host \|\| null/);
  assert.match(upsert, /qualityFlags, updatedAt/);
  assert.doesNotMatch(upsert, /\bfirst\?\.|\blast\?\.|\bprimaryHost\b/);
});

test('maintenance prioritizes stored daily summaries with invalid sample counts', () => {
  const invalid = section('async function invalidDailyPeriods', 'function mergePeriods');
  assert.match(invalid, /sample_count>\?/);
  assert.match(invalid, /reliable_sample_count>sample_count/);
  assert.match(invalid, /MAX_DAILY_MINUTE_SAMPLES/);

  const maintenance = section('export async function runRollupMaintenance', 'export async function runRollupMaintenanceSafely');
  assert.match(maintenance, /invalidDailyPeriods\(otherDb, now\)/);
  assert.match(maintenance, /\[\.\.\.invalidPeriods, \.\.\.dirtyPeriods\]/);
});
