import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const dashboardCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const dashboardLayout = readFileSync(new URL('../public/dashboard-current-layout.js', import.meta.url), 'utf8');
const dashboardStability = readFileSync(new URL('../public/dashboard-chart-stability.js', import.meta.url), 'utf8');
const dashboardDetail = readFileSync(new URL('../public/dashboard-chart-detail.js', import.meta.url), 'utf8');
const historyMain = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyLite = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const historyStability = readFileSync(new URL('../public/history/history-chart-stability.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');

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

test('history has one specialized canvas renderer per mode and explicit paint completion', () => {
  assert.match(historyMain, /function ensureHistoryModeRuntime/);
  assert.match(historyMain, /history-period-chart\.js\?v=20260923\.3/);
  assert.match(historyMain, /history-ranking-chart\.js\?v=20260923\.5/);
  assert.match(historyMain, /history-chart-stability\.js\?v=20260923\.2/);
  assert.match(historyLite, /history:data-loaded/);
  assert.doesNotMatch(historyLite, /function drawSummaryChart|function prepareCanvas|getContext\('2d'\)/);
  assert.match(periodChart, /history:data-loaded/);
  assert.match(periodChart, /history:period-chart-drawn/);
  assert.match(rankingChart, /history:data-loaded/);
  assert.match(rankingChart, /history:ranking-chart-drawn/);
  assert.doesNotMatch(periodChart, /window\.fetch|response\.clone\(\)\.json/);
  assert.doesNotMatch(rankingChart, /window\.fetch|response\.clone\(\)\.json/);
  assert.match(historyStability, /history:period-chart-drawn/);
  assert.match(historyStability, /history:ranking-chart-drawn/);
  assert.doesNotMatch(historyStability, /MutationObserver/);
  assert.match(historyStability, /paintPending/);
  assert.match(historyStability, /paintStable/);
  assert.match(historyStability, /document\.getElementById\('load'\)/);
});
