import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const readModel = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');
const dashboardEndpoint = readFileSync(new URL('../functions/api/dashboard.js', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../functions/lib/api-contract.js', import.meta.url), 'utf8');

test('shared bootstrap keeps every non-current view and first-week comparison lazy', () => {
  for (const asset of [
    'history-shell.js', 'first-week-comparison-shell.js', 'first-week-comparison.js', 'likes-shell.js',
    'hinata-shell.js', 'followers-shell.js', 'played-tracks-shell.js', 'spotify-shell.js',
    'amazon-music-shell.js', 'apple-music-shell.js', 'nogizaka-listening-party-shell.js',
    'dashboard-chart-stability.js', 'dashboard-chart-comparison.js', 'dashboard-chart-detail.js',
    'dashboard-daily-summaries.js', 'dashboard-details-client.js', 'dashboard-client.js',
  ]) assert.doesNotMatch(entry, new RegExp(`^import ['\"](?:\\./|/)${asset.replaceAll('.', '\\.')}`, 'm'), asset);

  for (const asset of [
    'history-shell.js', 'first-week-comparison-shell.js', 'first-week-comparison.js', 'likes-shell.js',
    'hinata-shell.js', 'followers-shell.js', 'played-tracks-shell.js', 'spotify-shell.js',
    'amazon-music-shell.js', 'apple-music-shell.js',
  ]) assert.match(tabs, new RegExp(asset.replaceAll('.', '\\.')));

  assert.match(tabs, /ensureDashboardSectionStyles/);
  assert.match(readFileSync(new URL('../public/dashboard-styles.js', import.meta.url), 'utf8'), /subscriptions/);
  assert.doesNotMatch(entry, /legacy-listening-party-route|dashboard-tab-order/);
});

test('Buddies cache is explicitly owned by the lazy read model, without global fetch replacement', () => {
  const adapter = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');
  const cache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
  assert.match(adapter, /import \{ fetchDashboard \}/);
  assert.match(adapter, /url.startsWith\('\/api\/dashboard\?'\) \? fetchDashboard : fetch/);
  assert.doesNotMatch(cache, /window\.fetch\s*=/);
  assert.doesNotMatch(entry, /dashboard-fetch-cache|^import.*current-shell/m);
});

test('dashboard materializer contains chart details and avoids a secondary browser D1 path', () => {
  assert.match(contract, /key: 'dashboard', url: '\/api\/dashboard\?history=0'/);
  assert.match(dashboardEndpoint, /augmentDashboardChartData/);
  assert.match(dashboardEndpoint, /daily_summaries/);
  assert.doesNotMatch(entry, /dashboard-details-client\.js/);
  assert.doesNotMatch(readModel, /\/api\/dashboard-details|dashboard:details/);
});
