import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rollup = readFileSync(new URL('../worker/src/rollup-maintenance.js', import.meta.url), 'utf8');
const reconcile = readFileSync(new URL('../worker/src/minute-facts-day-reconcile.js', import.meta.url), 'utf8');

test('daily reconciliation compares channel-minute key sets and enqueues only missing facts', () => {
  assert.match(reconcile, /PARTITION BY channel_id,CAST\(observed_at\/60000 AS INTEGER\)/);
  assert.match(reconcile, /FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_time/);
  assert.match(reconcile, /missing\.slice\(0, enqueueLimit\)/);
  assert.match(reconcile, /jobKind: 'rebuild'/);
  assert.match(reconcile, /status IN \('pending','processing','dead'\)/);
});

test('stale historical days are retried and summaries use source generations', () => {
  assert.match(rollup, /minuteFactReconcileCandidates\(now\)/);
  assert.match(rollup, /for \(const period of periods\)/);
  assert.match(rollup, /minute_generation:/);
  assert.match(rollup, /summaryGeneration\(existing\) === reconciliation\.generation/);
  assert.match(rollup, /daily\.rebuilt === true \|\| daily\.generated === true/);
});

test('legacy global Minute Facts repair is removed from the rollup path', () => {
  assert.doesNotMatch(rollup, /runMinuteFactsRepair/);
});
