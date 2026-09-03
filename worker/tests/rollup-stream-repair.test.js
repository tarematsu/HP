import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/rollup-maintenance.js', import.meta.url), 'utf8');
const reconcile = readFileSync(new URL('../src/minute-facts-day-reconcile.js', import.meta.url), 'utf8');
const repair = readFileSync(new URL('../scripts/repair-july-stream-facts.mjs', import.meta.url), 'utf8');
const observedIndexMigration = readFileSync(
  new URL('../../database/facts-migrations/048_force_rollup_observed_index.sql', import.meta.url),
  'utf8',
);

test('rollups reject total-listener values masquerading as total streams', () => {
  assert.match(source, /validated_stream_count IS NOT total_listens/);
  assert.match(source, /current_stream_count IS NOT total_listens/);
  assert.match(source, /COALESCE\([\s\S]*validated_stream_count[\s\S]*current_stream_count/);
});

test('daily reconciliation waits for complete source coverage', () => {
  assert.match(source, /reconcileMinuteFactsForDay/);
  assert.match(source, /reason: reconciliation\.blocked \? 'minute-facts-dead-jobs' : 'minute-facts-incomplete'/);
  assert.match(source, /summaryGeneration\(existing\) === reconciliation\.generation/);
  assert.match(reconcile, /FROM sh_channel_snapshots INDEXED BY idx_sh_channel_snapshots_observed_id/);
  assert.match(reconcile, /PARTITION BY channel_id,CAST\(observed_at\/60000 AS INTEGER\)/);
  assert.match(reconcile, /status IN \('pending','processing','dead'\)/);
  assert.match(source, /rollupMinuteDaily\(minuteDb, otherDb, period, now, qualityFlags\)/);
});

test('daily rebuild refreshes dependent weekly and monthly summaries', () => {
  assert.match(source, /completeDailyRange/);
  assert.match(source, /daily-summaries-incomplete/);
  assert.match(source, /completeWeeklyCoverage/);
  assert.match(source, /weekly-summaries-incomplete/);
  assert.match(source, /daily\.rebuilt === true \|\| daily\.generated === true/);
  assert.match(source, /weekly\.rebuilt === true/);
  assert.match(source, /minuteFactReconcileCandidates\(now\)/);
});

test('minute rollup compatibility view forces the observed-time index', () => {
  assert.match(observedIndexMigration, /INDEXED BY idx_sh_minute_facts_observed_id/);
  assert.match(observedIndexMigration, /CREATE INDEX IF NOT EXISTS idx_sh_minute_facts_observed_id/);
  assert.match(observedIndexMigration, /PRAGMA optimize/);
});

test('legacy special-case runtime repair is removed', () => {
  assert.doesNotMatch(source, /runMinuteFactsRepair/);
  assert.match(repair, /--apply/);
  assert.doesNotMatch(repair, /SET reported_current_stream_count=NULL/);
  assert.doesNotMatch(repair, /UPDATE sh_minute_facts/);
});
