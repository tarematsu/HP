import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');
const chartStability = readFileSync(new URL('../public/history/history-chart-stability.js', import.meta.url), 'utf8');
const historyMain = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const dashboardTabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const dashboardMetrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

test('compact featured ranking widths do not override the seven-column all-host table', () => {
  assert.match(cleanup, /table\.compact-columns:not\(\.all-host-ranking-table\)/);
  assert.doesNotMatch(
    cleanup,
    /#historyView \.table-wrap table\.compact-columns th:nth-child\(1\)/,
  );
});

test('refresh keeps an already stable history chart visible until replacement paint completes', () => {
  assert.match(chartStability, /function hasStablePaint\(\)/);
  assert.match(chartStability, /if \(!hasStablePaint\(\)\) conceal\(\);/);
  assert.match(chartStability, /nextMode && nextMode !== activeMode\(\)/);
});

test('leaderboard display fixes are cache-busted through the dashboard runtime chain', () => {
  assert.match(historyMain, /history-chart-stability\.js\?v=20260923\.3/);
  assert.match(historyMain, /history-table-cleanup\.js\?v=20260923\.3/);
  assert.match(dashboardTabs, /history-main\.js\?v=20260923\.7/);
  assert.match(dashboardMetrics, /dashboard-tabs\.js\?v=20260923\.5/);
});
