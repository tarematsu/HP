import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Promotion order is immutable: minute facts -> daily -> weekly -> monthly.
const source = readFileSync(new URL('../worker/src/rollup-maintenance.js', import.meta.url), 'utf8');

test('daily summaries rebuild only after minute facts catch up with BUDDIES', () => {
  assert.match(source, /loadSummary\(otherDb, 'sh_daily_summary'/);
  assert.match(source, /distinctSourceMinutes\(sourceDb, period\)/);
  assert.match(source, /distinctSourceMinutes\(minuteDb, period\)/);
  assert.match(source, /status<>'done'/);
  assert.match(source, /existingSampleCount/);
  assert.match(source, /existing\.sample_count \|\| 0\) === readiness\.factMinutes/);
  assert.match(source, /rollupDaily\(minuteDb, otherDb, period, now\)/);
});

test('daily rebuild cascades to weekly and monthly summaries', () => {
  assert.match(source, /refreshWeekly\(otherDb, weekRange, now, daily\.rebuilt === true\)/);
  assert.match(source, /daily\.rebuilt === true \|\| weekly\.rebuilt === true/);
  assert.match(source, /daily-summaries-incomplete/);
  assert.match(source, /weekly-summaries-incomplete/);
});
