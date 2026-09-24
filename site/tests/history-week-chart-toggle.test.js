import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');

test('past weekly checkbox makes the period chart resolve the effective weekly data mode', () => {
  assert.match(chart, /routeMode === 'daily'/);
  assert.match(chart, /getElementById\('historyPastWeekMode'\)\?\.checked/);
  assert.match(chart, /return 'weekly'/);
  assert.match(chart, /mode !== latestMode/);
});

test('period chart cache key is bumped with the weekly toggle fix', () => {
  assert.match(entry, /history-period-chart\.js\?v=20260923\.6/);
});
