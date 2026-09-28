import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

test('current-only dashboard runtime does not block the shared shell module graph', () => {
  for (const asset of [
    'dashboard-chart-stability.js',
    'dashboard-chart-comparison.js',
    'dashboard-chart-detail.js',
    'dashboard-daily-summaries.js',
    'dashboard-fetch-cache.js',
    'dashboard-client.js',
  ]) {
    assert.doesNotMatch(entry, new RegExp(`^import ['\"](?:\\./|/)${asset.replaceAll('.', '\\.')}`, 'm'), asset);
  }

  assert.match(entry, /function ensureCurrentRuntime\(\)/);
  assert.match(entry, /Promise\.all\(\[[\s\S]*dashboard-chart-stability\.js[\s\S]*dashboard-chart-comparison\.js[\s\S]*dashboard-chart-detail\.js[\s\S]*dashboard-daily-summaries\.js/);
  assert.match(entry, /await import\('\.\/dashboard-fetch-cache\.js\?v=20260923\.4'\)/);
  assert.match(entry, /await import\('\/dashboard-client\.js\?v=20260924\.1'\)/);
});

test('current runtime starts on the current route and when returning to the current tab', () => {
  assert.match(entry, /startCurrentRuntimeFromLocation\(\);/);
  assert.match(entry, /button\?\.dataset\.view === 'current'/);
  assert.match(entry, /window\.addEventListener\('popstate', startCurrentRuntimeFromLocation\)/);
  assert.match(entry, /window\.addEventListener\('hashchange', startCurrentRuntimeFromLocation\)/);
});
