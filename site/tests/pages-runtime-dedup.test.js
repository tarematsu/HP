import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fetchCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const historyMain = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyLite = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const pageFixes = readFileSync(new URL('../public/history/history-page-fixes.js', import.meta.url), 'utf8');
const axisLabels = readFileSync(new URL('../public/history/history-axis-labels.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');
const rankingMissing = readFileSync(new URL('../public/history/history-ranking-missing-gap.js', import.meta.url), 'utf8');

test('dashboard payload parsing is owned by the fetch cache instead of the entry module', () => {
  assert.doesNotMatch(metrics, /window\.fetch|response\.clone\(\)\.json|restoreDashboardCache|renderPayload/);
  assert.match(fetchCache, /mergePayload\(await response\.clone\(\)\.json\(\)\)/);
  assert.match(fetchCache, /Object\.defineProperty\(next, 'json'/);
  assert.match(fetchCache, /dispatchPayload\(payload, 'network'\)/);
});

test('inactive tab runtimes are loaded on demand and never idle-prefetched', () => {
  assert.match(tabs, /import\('\/history\/history-main\.js\?v=20260923\.5'\)/);
  assert.match(tabs, /import\('\/history\/history-likes\.js\?v=20260923\.4'\)/);
  assert.doesNotMatch(tabs, /modulepreload|requestIdleCallback|scheduleRuntimePrefetch/);
  assert.match(historyMain, /function ensureHistoryModeRuntime/);
  assert.match(historyMain, /history-period-chart\.js\?v=20260923\.2/);
  assert.match(historyMain, /history-ranking-chart\.js\?v=20260923\.5/);
  assert.match(historyMain, /history-broadcasts\.js\?v=20260923\.2/);
});

test('history payload is parsed once by the table runtime then shared with mode renderers', () => {
  assert.match(historyLite, /await response\.json\(\)/);
  assert.match(historyLite, /function publishHistoryData/);
  assert.match(historyLite, /history:data-loaded/);
  assert.doesNotMatch(historyLite, /function drawSummaryChart|function prepareCanvas/);
  for (const renderer of [periodChart, rankingChart]) {
    assert.match(renderer, /history:data-loaded/);
    assert.doesNotMatch(renderer, /window\.fetch|previousFetch|response\.clone\(\)\.json/);
  }
});

test('history metadata wrapper skips JSON parsing for normal summary modes', () => {
  const guard = pageFixes.indexOf('if (!needsMetadata) return response;');
  const parse = pageFixes.indexOf('response.clone().json()');
  assert.ok(guard >= 0 && parse > guard);
  assert.match(pageFixes, /searchParams\.get\('mode'\)[\s\S]*=== 'ranking'/);
});

test('ranking and axis updates do not keep duplicate legacy observers', () => {
  assert.doesNotMatch(rankingChart, /DOMNodeInserted|MutationObserver/);
  assert.doesNotMatch(rankingMissing, /window\.fetch|response\.clone\(\)\.json/);
  assert.match(rankingMissing, /history:ranking-chart-drawn/);
  assert.doesNotMatch(axisLabels, /modeTabs'\)\?\.addEventListener\('click'/);
  assert.match(axisLabels, /new MutationObserver/);
});
