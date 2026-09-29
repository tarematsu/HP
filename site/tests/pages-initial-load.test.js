import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
const detailsClient = readFileSync(new URL('../public/dashboard-details-client.js', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../functions/lib/api-contract.js', import.meta.url), 'utf8');

test('shared bootstrap excludes inactive tab shells and current-only heavy renderers', () => {
  for (const asset of [
    'first-week-comparison-shell.js',
    'played-tracks-shell.js',
    'spotify-shell.js',
    'dashboard-chart-stability.js',
    'dashboard-chart-comparison.js',
    'dashboard-chart-detail.js',
    'dashboard-daily-summaries.js',
    'dashboard-details-client.js',
    'dashboard-client.js',
  ]) {
    assert.doesNotMatch(entry, new RegExp(`^import ['\"](?:\\./|/)${asset.replaceAll('.', '\\.')}`, 'm'), asset);
  }

  assert.match(tabs, /import\('\/first-week-comparison-shell\.js\?v=/);
  assert.match(tabs, /import\('\/played-tracks-shell\.js\?v=/);
  assert.match(tabs, /import\('\/spotify-shell\.js\?v=/);
});

test('current listeners are ready before one cache restoration and the first network refresh', () => {
  const chartIndex = entry.indexOf("import('./dashboard-chart-comparison.js");
  const cacheIndex = entry.indexOf("import('./dashboard-fetch-cache.js");
  const clientIndex = entry.indexOf("import('/dashboard-client.js");
  const detailsIndex = entry.indexOf("import('./dashboard-details-client.js");
  assert.ok(chartIndex >= 0 && cacheIndex > chartIndex);
  assert.ok(clientIndex > cacheIndex && detailsIndex > cacheIndex);
  assert.doesNotMatch(entry, /replayCurrentPayload|runtime-replay/);
  assert.match(client, /const DASHBOARD_URL = '\/api\/dashboard\?history=0'/);
  assert.match(client, /refreshDashboard\(true\)/);
});

test('dashboard materializer is lean while chart details are fetched separately', () => {
  assert.match(contract, /key: 'dashboard', url: '\/api\/dashboard\?history=0'/);
  assert.match(detailsClient, /\/api\/dashboard-details\?channel_id=/);
  assert.match(detailsClient, /CACHE_MAX_AGE_MS = 15 \* 60_000/);
  assert.match(detailsClient, /NETWORK_MAX_AGE_MS = 4 \* 60_000/);
  assert.match(detailsClient, /dashboard:details/);
});
