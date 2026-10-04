import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const channelRuntime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const channelReadModel = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');
const dashboardCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const dashboardLayout = readFileSync(new URL('../public/dashboard-current-layout.js', import.meta.url), 'utf8');
const dashboardStability = readFileSync(new URL('../public/dashboard-chart-stability.js', import.meta.url), 'utf8');
const paintGate = readFileSync(new URL('../public/chart-paint-gate.js', import.meta.url), 'utf8');
const dashboardDetail = readFileSync(new URL('../public/dashboard-chart-detail.js', import.meta.url), 'utf8');
const historyMain = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyLite = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const historyStability = readFileSync(new URL('../public/history/history-chart-stability.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');

test('current Stationhead dashboard has one shared data adapter and Canvas runtime', () => {
  assert.match(dashboard, /stationhead-channel\.js\?v=/);
  assert.match(dashboard, /dashboard-fetch-cache\.js\?v=/);
  assert.doesNotMatch(dashboard, /dashboard-current-layout\.js|dashboard-chart-comparison\.js|dashboard-chart-detail\.js/);
  assert.match(channelRuntime, /prepareDashboardCanvas/);
  assert.match(channelRuntime, /function renderCurrentChart\(/);
  assert.match(channelReadModel, /async function fetchJson\(/);
  assert.match(channelReadModel, /function buddiesModel\(\)/);
  assert.match(channelReadModel, /function ohisamaModel\(\)/);
  assert.match(channelReadModel, /function nogizakaModel\(\)/);
  assert.doesNotMatch(channelRuntime, /window\.fetch|response\.clone\(\)\.json/);
  assert.doesNotMatch(dashboardLayout, /audienceChart|getContext\('2d'\)|clearRect\(/);
  assert.match(dashboardCache, /url\.searchParams\.set\('since'/);
});

test('current and history charts share one paint gate controller', () => {
  assert.match(paintGate, /export function createChartPaintGate\(/);
  assert.match(paintGate, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
  assert.match(paintGate, /fallbackMs > 0/);
  assert.match(paintGate, /node\.dataset\[pendingKey\]/);
  assert.match(paintGate, /node\.dataset\[stableKey\]/);
  assert.match(dashboardStability, /createChartPaintGate/);
  assert.match(historyStability, /createChartPaintGate/);
  assert.doesNotMatch(dashboardStability, /requestAnimationFrame|fallbackTimer|revealTimer/);
  assert.doesNotMatch(historyStability, /requestAnimationFrame|fallbackTimer|revealTimer/);
});

test('dashboard first paint settles from the unified materialized payload', () => {
  assert.match(dashboardStability, /pendingKey: 'initialPaintPending'/);
  assert.match(dashboardStability, /stableKey: 'initialPaintStable'/);
  assert.match(dashboardStability, /fallbackMs: 2500/);
  assert.match(dashboardStability, /oneShot: true/);
  assert.match(dashboardStability, /source === 'network' \? 180 : 280/);
  assert.match(dashboardStability, /Array\.isArray\(payload\?\.history\)/);
  assert.match(dashboardStability, /dashboard:payload/);
  assert.match(dashboardDetail, /currentChartDetail/);
  assert.match(dashboardDetail, /dashboard:payload/);
  assert.doesNotMatch(dashboardDetail, /dashboard:details/);
});

test('history has one specialized canvas renderer per mode and hides paint until it settles', () => {
  assert.match(historyMain, /function ensureHistoryModeRuntime/);
  assert.match(historyMain, /history-period-chart\.js\?v=\d{8}\.\d+/);
  assert.match(historyMain, /history-ranking-chart\.js\?v=20260930\.\d+/);
  assert.match(historyMain, /history-chart-stability\.js\?v=20260925\.1/);
  assert.doesNotMatch(historyMain, /history-ranking-missing-gap/);
  assert.match(historyLite, /history:data-loaded/);
  assert.doesNotMatch(historyLite, /function drawSummaryChart|function prepareCanvas|getContext\('2d'\)/);
  assert.match(periodChart, /history:data-loaded/);
  assert.match(periodChart, /history:period-chart-drawn/);
  assert.match(rankingChart, /history:data-loaded/);
  assert.match(rankingChart, /dashboardMissingIndexBands/);
  assert.match(rankingChart, /drawDashboardMissingBands/);
  assert.doesNotMatch(periodChart, /window\.fetch|response\.clone\(\)\.json/);
  assert.doesNotMatch(rankingChart, /window\.fetch|response\.clone\(\)\.json/);
  assert.match(historyStability, /history:period-chart-drawn/);
  assert.match(historyStability, /history:ranking-chart-drawn/);
  assert.doesNotMatch(historyStability, /MutationObserver|getContext\('2d'\)|clearRect\(/);
  assert.match(historyStability, /pendingKey: 'paintPending'/);
  assert.match(historyStability, /stableKey: 'paintStable'/);
  assert.match(historyStability, /fallbackMs: 1800/);
  assert.match(historyStability, /paintGate\.isStable\(\)/);
  assert.match(historyStability, /document\.getElementById\('load'\)/);
});

test('history mode switches clear stale shared chart state before the next renderer paints', () => {
  assert.match(historyStability, /function resetSharedChartPresentation\(\)/);
  assert.match(historyStability, /chartLegend'\)\?\.replaceChildren\(\)/);
  assert.match(historyStability, /chartStartDate/);
  assert.match(historyStability, /chartEndDate/);
  assert.match(historyStability, /\['chartYAxisLeft', 'chartYAxisRight', 'chartXAxisTitle'\]/);
  assert.match(historyStability, /function clearAxisLabel\(id\)/);
  assert.match(historyStability, /canvas\.width = canvas\.width/);
  assert.match(historyStability, /nextMode === 'broadcasts'[\s\S]*prepareBroadcastCanvas\(\)/);
  assert.match(historyStability, /paintGate\.show\(\)/);
  assert.match(historyStability, /paintedMode = 'broadcasts'/);
});

test('ranking query changes cannot leave the previous table chart visible', () => {
  assert.match(historyStability, /function prepareRankingQueryChange\(\)/);
  assert.match(historyStability, /paintedMode = ''[\s\S]*conceal\('ranking'\)/);
  assert.match(historyStability, /getElementById\('rankingScope'\)\?\.addEventListener\('change', prepareRankingQueryChange/);
  assert.match(historyStability, /getElementById\('rankingHost'\)\?\.addEventListener\('keydown',[\s\S]*event\.key === 'Enter'[\s\S]*prepareRankingQueryChange\(\)/);
});
