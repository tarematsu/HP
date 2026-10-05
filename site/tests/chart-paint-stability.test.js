import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const channelRuntime = browserSource('stationhead-channel.js');
const channelReadModel = browserSource('stationhead-channel-read-model.js');
const dashboardCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const paintGate = readFileSync(new URL('../public/chart-paint-gate.js', import.meta.url), 'utf8');
const historyMain = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyLite = browserSource('history/history-lite.js');
const historyStability = readFileSync(new URL('../public/history/history-chart-stability.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const leaderboardRuntime = browserSource('leaderboard.js');

test('current Stationhead dashboard has one shared data adapter and Canvas runtime', () => {
  assert.match(readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8'), /stationhead-channel\.js\?v=/);
  assert.match(channelReadModel, /import \{ fetchDashboard \}/);
  assert.doesNotMatch(dashboard, /dashboard-current-layout\.js|dashboard-chart-comparison\.js|dashboard-chart-detail\.js|dashboard-chart-stability\.js/);
  assert.match(channelRuntime, /prepareDashboardCanvas/);
  assert.match(channelRuntime, /function renderCurrentChart\(/);
  assert.match(channelRuntime, /function renderCurrentDetail\(/);
  assert.match(channelReadModel, /async function fetchJson\(/);
  assert.match(channelReadModel, /function buddiesModel\(\)/);
  assert.match(channelReadModel, /function ohisamaModel\(\)/);
  assert.match(channelReadModel, /function nogizakaModel\(\)/);
  assert.doesNotMatch(channelRuntime, /window\.fetch|response\.clone\(\)\.json/);
  assert.match(dashboardCache, /url\.searchParams\.set\('since'/);
});

test('history charts use the shared paint gate controller', () => {
  assert.match(paintGate, /export function createChartPaintGate\(/);
  assert.match(paintGate, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
  assert.match(paintGate, /fallbackMs > 0/);
  assert.match(paintGate, /node\.dataset\[pendingKey\]/);
  assert.match(paintGate, /node\.dataset\[stableKey\]/);
  assert.match(historyStability, /createChartPaintGate/);
  assert.doesNotMatch(historyStability, /requestAnimationFrame|fallbackTimer|revealTimer/);
});

test('current dashboard renders directly from the unified materialized payload', () => {
  assert.match(channelReadModel, /fetchJson\('\/api\/dashboard\?history=0'/);
  assert.match(channelReadModel, /history_24h: normalizedHistory/);
  assert.match(channelReadModel, /previous_day_history: previousDayHistory/);
  assert.match(channelRuntime, /function renderCurrent\(runtime, payload\)/);
  assert.match(channelRuntime, /renderCurrentChart\(runtime, payload\)/);
  assert.doesNotMatch(channelRuntime, /dashboard:details/);
});

test('history owns period charts while the shared leaderboard owns ranking canvas paint', () => {
  assert.match(historyMain, /function ensureHistoryModeRuntime/);
  assert.match(historyMain, /history-period-chart\.js\?v=\d{8}\.\d+/);
  assert.doesNotMatch(historyMain, /history-ranking-chart\.js/);
  assert.match(historyMain, /history-chart-stability\.js\?v=20260925\.1/);
  assert.doesNotMatch(historyMain, /history-ranking-missing-gap/);
  assert.match(historyLite, /history:data-loaded/);
  assert.doesNotMatch(historyLite, /function drawSummaryChart|function prepareCanvas|getContext\('2d'\)/);
  assert.match(periodChart, /history:data-loaded/);
  assert.match(periodChart, /history:period-chart-drawn/);
  assert.doesNotMatch(periodChart, /window\.fetch|response\.clone\(\)\.json/);
  assert.match(leaderboardRuntime, /prepareDashboardCanvas/);
  assert.match(leaderboardRuntime, /drawDashboardLine/);
  assert.match(leaderboardRuntime, /observeDashboardChartResize/);
  assert.doesNotMatch(leaderboardRuntime, /window\.fetch|response\.clone\(\)\.json|MutationObserver|DOMNodeInserted/);
  assert.match(historyStability, /history:period-chart-drawn/);
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

test('shared leaderboard redraws only its current payload after resize or pointer selection', () => {
  assert.match(leaderboardRuntime, /canvas\?\.addEventListener\('pointerup'/);
  assert.match(leaderboardRuntime, /nearestPositionIndex\(chartModel\.positions/);
  assert.match(leaderboardRuntime, /observeDashboardChartResize\(canvas,[\s\S]*if \(currentPayload\) renderChart\(currentPayload\)/);
  assert.match(leaderboardRuntime, /enabled: \(\) => Boolean\(currentPayload\?\.series\?\.length\)/);
});
