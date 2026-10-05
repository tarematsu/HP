import { browserSource } from './helpers/dashboard-source.js';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fetchCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const tabs = dashboardRouterSource();
const historyMain = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyLite = browserSource('history/history-lite.js');
const historyDataClient = readFileSync(new URL('../public/history/history-data-client.js', import.meta.url), 'utf8');
const axisLabels = readFileSync(new URL('../public/history/history-axis-labels.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const leaderboardRuntime = browserSource('leaderboard.js');
const leaderboardModel = readFileSync(new URL('../public/leaderboard-read-model.js', import.meta.url), 'utf8');

test('dashboard payload parsing is owned by the fetch cache instead of the entry module', () => {
  assert.doesNotMatch(metrics, /window\.fetch|response\.clone\(\)\.json|restoreDashboardCache|renderPayload/);
  assert.match(fetchCache, /mergePayload\(await response\.clone\(\)\.json\(\)\)/);
  assert.match(fetchCache, /Object\.defineProperty\(next, 'json'/);
  assert.match(fetchCache, /dispatchPayload\(payload, 'network'\)/);
});

test('inactive tab shells and runtimes are loaded on demand through one shared loader and never idle-prefetched', () => {
  assert.match(tabs, /const LAZY_VIEWS = \{/);
  assert.match(tabs, /const modulePromises = new Map\(\)/);
  assert.match(readFileSync(new URL('../public/dashboard-styles.js', import.meta.url), 'utf8'), /const stylePromises = new Map\(\)/);
  assert.match(tabs, /function loadDashboardModuleOnce\(key, importer\)/);
  assert.match(tabs, /shell: \(\) => import\('\/history-shell\.js\?v=20260930\.1'\)/);
  assert.match(tabs, /import\('\/history\/history-main\.js\?v=\d{8}\.\d+'\)/);
  assert.match(tabs, /selectStationheadChannelSection/);
  assert.match(tabs, /ranking:\s*\{[\s\S]*leaderboard-shell\.js[\s\S]*leaderboard\.js[\s\S]*source: 'stationhead'/);
  assert.doesNotMatch(tabs, /history-ranking-table-status|ranking-status/);
  assert.doesNotMatch(tabs, /modulepreload|requestIdleCallback|scheduleRuntimePrefetch|loadRankingStatusRuntime|loadHistoryRuntime/);
  assert.match(historyMain, /function ensureHistoryModeRuntime/);
  assert.match(historyMain, /history-period-chart\.js\?v=\d{8}\.\d+/);
  assert.doesNotMatch(historyMain, /history-ranking-chart\.js/);
  assert.match(historyMain, /history-broadcasts\.js\?v=20261001\.1/);
  assert.doesNotMatch(historyMain, /history-ranking-missing-gap/);
});

test('history payload is parsed once by the data client while leaderboard has its own source adapter', () => {
  const client=browserSource('history/history-data-client.js'); assert.match(client,/fetchHistoryPayload/); assert.match(client,/createHistoryPayloadCache/); assert.doesNotMatch(readFileSync(new URL('../public/history/history-lite.js',import.meta.url),'utf8'),/response.json/); assert.match(browserSource('leaderboard-read-model.js'),/loadDashboardJson/);
});

test('history summary presentation stays in the shared history renderer', () => {
  assert.match(historyLite,/createHistorySummary/); assert.match(historyLite,/function updateSummary/); assert.match(historyLite,/平均再生数増加量/); assert.doesNotMatch(historyLite,/rankingWeekCounts/);
});

test('shared leaderboard owns missing bands without duplicate legacy observers or fetch overlays', () => {
  assert.doesNotMatch(leaderboardRuntime, /DOMNodeInserted|MutationObserver|previousFetch|response\.clone\(\)\.json/);
  assert.match(leaderboardRuntime, /dashboardMissingIndexBands/);
  assert.match(leaderboardRuntime, /drawDashboardMissingBands/);
  assert.match(leaderboardRuntime, /DASHBOARD_MISSING_KEY/);
  assert.match(axisLabels, /history:data-loaded/);
  assert.match(axisLabels, /hashchange/);
  assert.doesNotMatch(axisLabels, /modeTabs'\)\?\.addEventListener\('click'|MutationObserver|createElement\('style'\)/);
});
