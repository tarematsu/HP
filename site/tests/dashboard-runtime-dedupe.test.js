import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [entry, client, fetchCache, chart, detail, daily, stability] = await Promise.all([
  read('../public/dashboard-metrics.js'),
  read('../public/dashboard-client.js'),
  read('../public/dashboard-fetch-cache.js'),
  read('../public/dashboard-chart-comparison.js'),
  read('../public/dashboard-chart-detail.js'),
  read('../public/dashboard-daily-summaries.js'),
  read('../public/dashboard-chart-stability.js'),
]);

test('dashboard cache is restored and persisted by one owner', () => {
  assert.match(fetchCache, /DASHBOARD_CACHE_KEY = 'sh\.dashboard\.v3'/);
  assert.match(fetchCache, /localStorage\.getItem\(DASHBOARD_CACHE_KEY\)/);
  assert.match(fetchCache, /localStorage\.setItem\(DASHBOARD_CACHE_KEY/);
  assert.doesNotMatch(client, /CACHE_KEY|localStorage\.(?:getItem|setItem)/);
  assert.match(client, /applyPayload\(window\.__dashboardCurrentPayload\)/);
});

test('Buddies cache is explicitly owned by the lazy read model, without global fetch replacement', () => {
  const adapter = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');
  const cache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
  assert.match(adapter, /import \{ fetchDashboard \}/);
  assert.match(adapter, /url.startsWith\('\/api\/dashboard\?'\) \? fetchDashboard : fetch/);
  assert.doesNotMatch(cache, /window\.fetch\s*=/);
  assert.doesNotMatch(entry, /dashboard-fetch-cache|^import.*current-shell/m);
});

test('visibility and interval refreshes share a minimum request gap', () => {
  assert.match(client, /MIN_REFRESH_GAP_MS = 45_000/);
  assert.match(client, /now - state\.lastRefreshStartedAt < MIN_REFRESH_GAP_MS/);
  assert.match(client, /refreshDashboard\(true\)/);
});

test('heavy current-tab renderers consume only the unified dashboard payload', () => {
  assert.doesNotMatch(entry, /dashboard-details-client\.js/);
  for (const source of [chart, detail, daily, stability]) {
    assert.match(source, /dashboard:payload/);
    assert.doesNotMatch(source, /dashboard:details/);
  }
});

test('secondary dashboard details are not dispatched on current-tab refreshes', () => {
  assert.doesNotMatch(entry, /dashboard-details-client\.js/);
  assert.doesNotMatch(client, /dashboard-details|dashboard:details/);
  assert.equal((client.match(/\/api\/dashboard/g) || []).length, 1);
});
