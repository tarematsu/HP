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

test('daily promotion is immutable and waits for complete minute facts', () => {
  assert.match(source, /summaryExists\(otherDb, 'sh_daily_summary'/);
  assert.match(source, /distinctSourceMinutes\(sourceDb, period\)/);
  assert.match(source, /distinctSourceMinutes\(minuteDb, period\)/);
  assert.match(source, /status<>'done'/);
  assert.match(source, /reason: 'minute-facts-incomplete'/);
  assert.match(source, /INSERT INTO sh_daily_summary/);
});

test('weekly and monthly summaries are promoted only after lower levels are complete', () => {
  assert.match(source, /completeDailyRange/);
  assert.match(source, /daily-summaries-incomplete/);
  assert.match(source, /completeWeeklyCoverage/);
  assert.match(source, /weekly-summaries-incomplete/);
  assert.match(source, /rollupFromDaily\(otherDb, 'sh_weekly_summary'/);
  assert.match(source, /rollupFromDaily\(otherDb, 'sh_monthly_summary'/);
  assert.match(source, /const period = previousUtcDay\(now\)/);
});

test('minute fact repair uses a remote preflight and never destructively nulls facts', () => {
  assert.match(repair, /--apply/);
  assert.match(repair, /024_minute_fact_repairs\.sql/);
  assert.match(repair, /source-verified Queue repairs/);
  assert.doesNotMatch(repair, /SET reported_current_stream_count=NULL/);
  assert.doesNotMatch(repair, /UPDATE sh_minute_facts/);
});
