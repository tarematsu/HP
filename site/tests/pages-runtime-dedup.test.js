import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fetchCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const pageFixes = readFileSync(new URL('../public/history/history-page-fixes.js', import.meta.url), 'utf8');
const axisLabels = readFileSync(new URL('../public/history/history-axis-labels.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');
const rankingMissing = readFileSync(new URL('../public/history/history-ranking-missing-gap.js', import.meta.url), 'utf8');

test('dashboard payload parsing is owned by the fetch cache instead of the entry module', () => {
  assert.doesNotMatch(metrics, /window\.fetch|response\.clone\(\)\.json|restoreDashboardCache|renderPayload/);
  assert.match(fetchCache, /mergePayload\(await response\.clone\(\)\.json\(\)\)/);
  assert.match(fetchCache, /Object\.defineProperty\(next, 'json'/);
  assert.match(fetchCache, /dispatchPayload\(payload, 'network'\)/);
});

test('inactive tab runtimes are loaded on demand and never idle-prefetched', () => {
  assert.match(tabs, /import\('\/history\/history-main\.js\?v=20260923\.4'\)/);
  assert.match(tabs, /import\('\/history\/history-likes\.js\?v=20260923\.4'\)/);
  assert.doesNotMatch(tabs, /modulepreload|requestIdleCallback|scheduleRuntimePrefetch/);
});

test('history metadata wrapper skips JSON parsing for normal summary modes', () => {
  const guard = pageFixes.indexOf('if (!needsMetadata) return response;');
  const parse = pageFixes.indexOf('response.clone().json()');
  assert.ok(guard >= 0 && parse > guard);
  assert.match(pageFixes, /searchParams\.get\('mode'\)[\s\S]*=== 'ranking'/);
});

test('ranking and axis updates do not keep duplicate legacy observers', () => {
  assert.doesNotMatch(rankingChart, /DOMNodeInserted/);
  assert.doesNotMatch(rankingMissing, /window\.fetch|response\.clone\(\)\.json/);
  assert.match(rankingMissing, /history:ranking-chart-drawn/);
  assert.doesNotMatch(axisLabels, /modeTabs'\)\?\.addEventListener\('click'/);
  assert.match(axisLabels, /new MutationObserver/);
});
