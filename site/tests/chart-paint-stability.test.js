import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const dashboardCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const dashboardLayout = readFileSync(new URL('../public/dashboard-current-layout.js', import.meta.url), 'utf8');
const dashboardStability = readFileSync(new URL('../public/dashboard-chart-stability.js', import.meta.url), 'utf8');
const dashboardDetail = readFileSync(new URL('../public/dashboard-chart-detail.js', import.meta.url), 'utf8');
const historyMain = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyStability = readFileSync(new URL('../public/history/history-chart-stability.js', import.meta.url), 'utf8');

test('dashboard has one response parser and one canvas renderer', () => {
  assert.doesNotMatch(dashboard, /dashboard-current-enhancements\.js/);
  assert.match(dashboard, /dashboard-current-layout\.js\?v=20260923\.4/);
  assert.match(dashboard, /dashboard-chart-stability\.js\?v=20260923\.4/);
  assert.match(dashboard, /dashboard-chart-comparison\.js\?v=20260923\.4/);
  assert.match(dashboard, /dashboard-chart-detail\.js\?v=20260923\.4/);
  assert.match(dashboard, /dashboard-fetch-cache\.js\?v=20260923\.4/);
  assert.doesNotMatch(dashboard, /window\.fetch|response\.clone\(\)\.json|renderPayload|restoreDashboardCache/);
  assert.match(dashboardCache, /function dispatchPayload\(payload, source\)/);
  assert.match(dashboardCache, /detail: \{ payload, source \}/);
  assert.match(dashboardCache, /function responseWithParsedPayload/);
  assert.match(dashboardCache, /Object\.defineProperty\(next, 'json'/);
  assert.match(dashboardCache, /dispatchPayload\(state\.lastPayload, 'cache'\)/);
  assert.match(dashboardCache, /dispatchPayload\(payload, 'network'\)/);
  assert.doesNotMatch(dashboardLayout, /audienceChart|getContext\('2d'\)|clearRect\(/);
});

test('dashboard first paint stays hidden until the comparison renderer settles', () => {
  assert.match(dashboardStability, /initialPaintPending/);
  assert.match(dashboardStability, /source === 'network' \? 380 : 900/);
  assert.match(dashboardStability, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
  assert.match(dashboardStability, /initialPaintStable/);
  assert.match(dashboardDetail, /currentChartDetail/);
  assert.match(dashboardDetail, /dashboard:payload/);
});

test('history hides intermediate generic chart paint until specialized renderers finish', () => {
  const stabilityIndex = historyMain.indexOf('history-chart-stability.js');
  const periodIndex = historyMain.indexOf('history-period-chart.js');
  const liteIndex = historyMain.indexOf('history-lite.js');
  assert.ok(stabilityIndex >= 0 && periodIndex > stabilityIndex && liteIndex > periodIndex);
  assert.match(historyStability, /data-period-chart/);
  assert.match(historyStability, /history:ranking-chart-drawn/);
  assert.match(historyStability, /paintPending/);
  assert.match(historyStability, /paintStable/);
  assert.match(historyStability, /document\.getElementById\('load'\)/);
});
