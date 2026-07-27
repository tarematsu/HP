import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../worker/src/rollup-maintenance.js', import.meta.url), 'utf8');

test('daily summaries are immutable and completeness-gated', () => {
  assert.match(source, /summaryExists\(otherDb, 'sh_daily_summary'/);
  assert.match(source, /distinctSourceMinutes\(sourceDb, period\)/);
  assert.match(source, /distinctSourceMinutes\(minuteDb, period\)/);
  assert.match(source, /status<>'done'/);
  assert.match(source, /INSERT INTO sh_daily_summary/);
  assert.doesNotMatch(source, /INSERT INTO sh_daily_summary[\s\S]{0,800}ON CONFLICT/);
});

test('weekly and monthly promotion require complete lower summaries', () => {
  assert.match(source, /daily-summaries-incomplete/);
  assert.match(source, /weekly-summaries-incomplete/);
  assert.match(source, /insertWeeklyOnce/);
  assert.match(source, /insertMonthlyOnce/);
});
