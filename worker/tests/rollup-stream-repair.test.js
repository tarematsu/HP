import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/rollup-maintenance.js', import.meta.url), 'utf8');
const repair = readFileSync(new URL('../scripts/repair-july-stream-facts.mjs', import.meta.url), 'utf8');

test('rollups reject total-listener values masquerading as total streams', () => {
  assert.match(source, /validated_stream_count IS NOT total_listens/);
  assert.match(source, /current_stream_count IS NOT total_listens/);
  assert.match(source, /COALESCE\([\s\S]*validated_stream_count[\s\S]*current_stream_count/);
});

test('daily rebuild waits for Minute Facts repair and complete source coverage', () => {
  assert.match(source, /runMinuteFactsRepair\(\{ DB: db, MINUTE_DB: minuteDb \}, now\)/);
  assert.match(source, /reason: 'minute-facts-rebuild-pending'/);
  assert.match(source, /loadSummary\(otherDb, 'sh_daily_summary'/);
  assert.match(source, /distinctSourceMinutes\(sourceDb, period\)/);
  assert.match(source, /distinctSourceMinutes\(minuteDb, period\)/);
  assert.match(source, /status<>'done'/);
  assert.match(source, /sh_minute_fact_rebuild_state/);
  assert.match(source, /pendingRebuildCandidates/);
  assert.match(source, /unscannedSourceExists/);
  assert.match(source, /rollupDaily\(minuteDb, otherDb, period, now\)/);
});

test('completed rebuild timestamps force one daily recreation even when counts match', () => {
  assert.match(source, /latestMinuteFactRebuildAt/);
  assert.match(source, /job_kind IN \('rebuild','repair'\)/);
  assert.match(source, /status='repaired'/);
  assert.match(source, /existingUpdatedAt >= latestRebuildAt/);
  assert.match(source, /rebuilt: Boolean\(existing && written\)/);
});

test('daily rebuild refreshes dependent weekly and monthly summaries', () => {
  assert.match(source, /completeDailyRange/);
  assert.match(source, /daily-summaries-incomplete/);
  assert.match(source, /completeWeeklyCoverage/);
  assert.match(source, /weekly-summaries-incomplete/);
  assert.match(source, /refreshWeekly\(otherDb, weekRange, now, daily\.rebuilt === true\)/);
  assert.match(source, /daily\.rebuilt === true \|\| weekly\.rebuilt === true/);
  assert.match(source, /const period = previousUtcDay\(now\)/);
});

test('minute fact repair uses a remote preflight and never destructively nulls facts', () => {
  assert.match(repair, /--apply/);
  assert.match(repair, /024_minute_fact_repairs\.sql/);
  assert.match(repair, /source-verified Queue repairs/);
  assert.doesNotMatch(repair, /SET reported_current_stream_count=NULL/);
  assert.doesNotMatch(repair, /UPDATE sh_minute_facts/);
});
