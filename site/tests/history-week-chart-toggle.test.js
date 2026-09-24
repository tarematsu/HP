import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');

test('period chart uses only explicit daily and weekly modes', () => {
  assert.match(chart, /const SUMMARY_MODES = new Set\(\['daily', 'weekly'\]\)/);
  assert.doesNotMatch(chart, /historyPastWeek|routeMode === 'daily'/);
  assert.match(chart, /mode !== latestMode/);
});

test('period chart cache key is bumped after removing the weekly toggle', () => {
  assert.match(entry, /history-period-chart\.js\?v=20260925\.1/);
});
