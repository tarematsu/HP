import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Routine promotion is immutable: minute facts -> daily -> weekly -> monthly.
// Explicit repair is a separate one-shot path after Minute Facts rebuild completion.
const source = readFileSync(new URL('../worker/src/rollup-maintenance.js', import.meta.url), 'utf8');

test('routine daily summaries are immutable and completeness-gated', () => {
  assert.match(source, /summaryExists\(otherDb, 'sh_daily_summary'/);
  assert.match(source, /distinctSourceMinutes\(sourceDb, period\)/);
  assert.match(source, /distinctSourceMinutes\(minuteDb, period\)/);
  assert.match(source, /status<>'done'/);
  assert.match(source, /pendingRebuildCandidates/);
  assert.match(source, /unscannedSourceExists/);
  assert.match(source, /INSERT INTO sh_daily_summary/);
  assert.doesNotMatch(source, /INSERT INTO sh_daily_summary[\s\S]{0,800}ON CONFLICT/);
});

test('explicit summary repair is one-shot and rebuild-gated', () => {
  assert.match(source, /minuteFactsRepair\?\.complete === true/);
  assert.match(source, /repairSummaryKeys/);
  assert.match(source, /reason: 'already-repaired'/);
  assert.match(source, /reason: 'minute-facts-rebuild-pending'/);
  assert.match(source, /rollupDaily\(minuteDb, otherDb, utcPeriod\(key\), now\)/);
  assert.match(source, /ON CONFLICT\(period_key\) DO UPDATE SET/);
});

test('weekly and monthly promotion require complete lower summaries', () => {
  assert.match(source, /daily-summaries-incomplete/);
  assert.match(source, /weekly-summaries-incomplete/);
  assert.match(source, /insertWeeklyOnce/);
  assert.match(source, /insertMonthlyOnce/);
});
