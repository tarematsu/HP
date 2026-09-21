import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rollup = readFileSync(new URL('../worker/src/rollup-maintenance.js', import.meta.url), 'utf8');
const reconcile = readFileSync(new URL('../worker/src/minute-facts-day-reconcile.js', import.meta.url), 'utf8');

test('daily reconciliation detects missing and stale channel-minute facts', () => {
  assert.match(reconcile, /PARTITION BY channel_id,CAST\(observed_at\/60000 AS INTEGER\)/);
  assert.match(reconcile, /source_record_id,source_priority/);
  assert.match(reconcile, /classifyExpected\(expected, materialized\)/);
  assert.match(reconcile, /const rebuild = \[\.\.\.missing, \.\.\.stale\]/);
  assert.match(reconcile, /expectedSourceRecordId\(row\)/);
});

test('missing done and dead jobs are forcefully requeued from source snapshots', () => {
  assert.match(reconcile, /requeueCompleted: true/);
  assert.match(reconcile, /forceRepair: true/);
  assert.match(reconcile, /source_generation: generation/);
  assert.match(reconcile, /build_version: RECONCILE_BUILD_VERSION/);
});

test('completion only considers jobs belonging to expected keys', () => {
  assert.match(reconcile, /loadRelevantJobState/);
  assert.match(reconcile, /if \(!expectedKeys\.has\(minuteKey\(row\.channel_id, row\.minute_at\)\)\) continue/);
  assert.match(reconcile, /status IN \('pending','processing','dead'\)/);
});

test('reconciliation fingerprints source content and verifies concurrent appends with one tip seek', () => {
  assert.match(reconcile, /function sourceFingerprint/);
  assert.match(reconcile, /FINGERPRINT_COLUMNS/);
  assert.match(reconcile, /async function loadSourceTip/);
  assert.match(reconcile, /ORDER BY observed_at DESC,id DESC\s+LIMIT 1/);
  assert.match(reconcile, /const finalTip = loadedTip\(await loadSourceTip/);
  assert.doesNotMatch(reconcile, /const verified = await loadExpectedMinutes/);
  assert.match(reconcile, /sourceChanged/);
  assert.match(reconcile, /source-changed-during-reconcile/);
});

test('stale historical days rotate once per UTC day while yesterday remains frequent', () => {
  assert.match(reconcile, /DEFAULT_LOOKBACK_DAYS = 90/);
  assert.match(reconcile, /HISTORICAL_RECONCILE_UTC_HOUR = 0/);
  assert.match(reconcile, /if \(utcHour !== historicalHour\) return periods/);
  assert.match(rollup, /minuteFactReconcileCandidates\(now\)/);
  assert.match(rollup, /for \(const period of periods\)/);
  assert.match(rollup, /minute_generation:/);
  assert.match(rollup, /summaryGeneration\(existing\) === reconciliation\.generation/);
});

test('legacy global Minute Facts repair remains removed from the rollup path', () => {
  assert.doesNotMatch(rollup, /runMinuteFactsRepair/);
});


test('dirty days persist and aggregate generations propagate to dependent summaries', () => {
  assert.match(rollup, /persistentDirtyPeriods/);
  assert.match(rollup, /last_rollup_key LIKE 'dirty:%'/);
  assert.match(rollup, /persistReconcileState/);
  assert.match(rollup, /daily_generation:/);
  assert.match(rollup, /rangeGeneration\(dailyRows\)/);
});