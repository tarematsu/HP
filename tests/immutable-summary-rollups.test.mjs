import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Promotion order: Minute Facts repair -> daily -> weekly -> monthly.
const source = readFileSync(new URL('../worker/src/rollup-maintenance.js', import.meta.url), 'utf8');

test('daily summaries rebuild only after all Minute Facts work completes', () => {
  assert.match(source, /runMinuteFactsRepair\(\{ DB: db, MINUTE_DB: minuteDb \}, now\)/);
  assert.match(source, /minute-facts-rebuild-pending/);
  assert.match(source, /loadSummary\(otherDb, 'sh_daily_summary'/);
  assert.match(source, /distinctSourceMinutes\(sourceDb, period\)/);
  assert.match(source, /distinctSourceMinutes\(minuteDb, period\)/);
  assert.match(source, /status<>'done'/);
  assert.match(source, /pendingRebuildCandidates/);
  assert.match(source, /unscannedSourceExists/);
  assert.match(source, /latestMinuteFactRebuildAt/);
  assert.match(source, /existingUpdatedAt >= latestRebuildAt/);
  assert.match(source, /rollupDaily\(minuteDb, otherDb, period, now\)/);
  assert.ok(
    source.indexOf('runMinuteFactsRepair({ DB: db, MINUTE_DB: minuteDb }, now)')
      < source.indexOf('rebuildDailyWhenComplete(db, minuteDb, otherDb, period, now)'),
  );
});

test('same-size repairs still rebuild once and then become current', () => {
  assert.match(source, /job_kind IN \('rebuild','repair'\)/);
  assert.match(source, /status='repaired'/);
  assert.match(source, /Number\(existing\.sample_count \|\| 0\) === readiness\.factMinutes/);
  assert.match(source, /existingUpdatedAt >= latestRebuildAt/);
  assert.match(source, /reason: 'already-current'/);
});

test('daily rebuild cascades to weekly and monthly summaries', () => {
  assert.match(source, /refreshWeekly\(otherDb, weekRange, now, daily\.rebuilt === true\)/);
  assert.match(source, /daily\.rebuilt === true \|\| weekly\.rebuilt === true/);
  assert.match(source, /daily-summaries-incomplete/);
  assert.match(source, /weekly-summaries-incomplete/);
});
