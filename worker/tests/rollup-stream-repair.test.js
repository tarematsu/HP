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

test('daily summaries finalize only after BUDDIES rebuild and Minute Facts checks', () => {
  assert.match(source, /runMinuteFactsRepair/);
  assert.match(source, /sh_minute_fact_rebuild_state/);
  assert.match(source, /pendingCandidatesInPeriod/);
  assert.match(source, /unscannedSourceExists/);
  assert.match(source, /unfinishedMinuteJobs/);
  assert.match(source, /unfinishedRepairs/);
  assert.match(source, /sourceMinuteKeys/);
  assert.match(source, /factMinuteKeys/);
  assert.match(source, /minute-facts-incomplete/);
});

test('summary hierarchy is immutable and lower-level complete', () => {
  assert.match(source, /INSERT OR IGNORE INTO \$\{table\}/);
  assert.doesNotMatch(source, /ON CONFLICT\(period_key\) DO UPDATE/);
  assert.match(source, /finalizeNextDaily/);
  assert.match(source, /finalizeNextWeekly/);
  assert.match(source, /finalizeNextMonthly/);
  assert.match(source, /daily-summaries-incomplete/);
  assert.match(source, /weekly-summaries-incomplete/);
  assert.doesNotMatch(source, /repairSummaryKeys|repairContaminatedSummaries|repairMinuteSourceSummaries/);
});

test('daily aggregation reads Minute Facts and not raw BUDDIES snapshots', () => {
  assert.match(source, /rollupDailyOnce\(minuteDb, otherDb, period, now\)/);
  assert.match(source, /inspectDailySummaryReadiness\(sourceDb, minuteDb, period\)/);
  assert.match(source, /FROM sh_channel_snapshots[\s\S]*WHERE observed_at>=\? AND observed_at<\?/);
  assert.doesNotMatch(source, /const summarySourceDb = minuteDb \|\| db/);
});

test('minute fact repair uses a remote preflight and never destructively nulls facts', () => {
  assert.match(repair, /--apply/);
  assert.match(repair, /024_minute_fact_repairs\.sql/);
  assert.match(repair, /source-verified Queue repairs/);
  assert.doesNotMatch(repair, /SET reported_current_stream_count=NULL/);
  assert.doesNotMatch(repair, /UPDATE sh_minute_facts/);
});
