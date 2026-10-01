import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
const dashboardEndpoint = readFileSync(new URL('../functions/api/dashboard.js', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../functions/lib/api-contract.js', import.meta.url), 'utf8');

test('shared bootstrap eagerly includes first-week comparison while keeping unrelated heavy renderers lazy', () => {
  assert.match(entry, /^import '\.\/first-week-comparison-shell\.js\?v=20261002\.2';$/m);
  assert.match(entry, /^import '\.\/first-week-comparison\.js\?v=20261002\.2';$/m);
  for (const asset of [
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

  assert.doesNotMatch(tabs, /first-week-comparison-shell|first-week-comparison\.js/);
  assert.match(tabs, /import\('\/played-tracks-shell\.js\?v=/);
  assert.match(tabs, /import\('\/spotify-shell\.js\?v=/);
});

test('current listeners are ready before one cache restoration and the first network refresh', () => {
  const chartIndex = entry.indexOf("import('./dashboard-chart-comparison.js");
  const cacheIndex = entry.indexOf("import('./dashboard-fetch-cache.js");
  const clientIndex = entry.indexOf("import('/dashboard-client.js");
  assert.ok(chartIndex >= 0 && cacheIndex > chartIndex);
  assert.ok(clientIndex > cacheIndex);
  assert.doesNotMatch(entry, /dashboard-details-client\.js|replayCurrentPayload|runtime-replay/);
  assert.match(client, /const DASHBOARD_URL = '\/api\/dashboard\?history=0'/);
  assert.match(client, /refreshDashboard\(true\)/);
});

test('dashboard materializer contains chart details and avoids a secondary browser D1 path', () => {
  assert.match(contract, /key: 'dashboard', url: '\/api\/dashboard\?history=0'/);
  assert.match(dashboardEndpoint, /augmentDashboardChartData/);
  assert.match(dashboardEndpoint, /daily_summaries/);
  assert.doesNotMatch(entry, /dashboard-details-client\.js/);
  assert.doesNotMatch(client, /\/api\/dashboard-details|dashboard:details/);
});
