import { browserSource } from './helpers/dashboard-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [entry, runtime, readModel, fetchCache] = await Promise.all([
  read('../public/dashboard-metrics.js'),
  browserSource('stationhead-channel.js'),
  browserSource('stationhead-channel-read-model.js'),
  read('../public/dashboard-fetch-cache.js'),
]);

test('dashboard fetch adapter keeps only in-memory delta state', () => {
  assert.doesNotMatch(fetchCache, /localStorage|sessionStorage|CacheStorage|caches\.open/);
  assert.match(fetchCache, /const state = \{/);
  assert.match(fetchCache, /latestObservedAt/);
  assert.match(readModel, /import \{ fetchDashboard \}/);
  assert.match(readModel, /if \(!url\.startsWith\('\/api\/dashboard\?'\)\) return loadDashboardJson/);
  assert.match(readModel, /const response = await fetchDashboard\(url/);
  assert.doesNotMatch(fetchCache, /window\.fetch\s*=/);
  assert.doesNotMatch(entry, /dashboard-fetch-cache|^import.*current-shell/m);
});

test('one visible Stationhead scheduler owns current refreshes', () => {
  assert.match(runtime, /function visibleCurrentRuntime\(\)/);
  assert.match(runtime, /loadSection\(runtime, 'current', \{ force: true \}\)/);
  assert.match(runtime, /}, 60_000\);/);
  assert.doesNotMatch(runtime, /setInterval\([^]*45_000/);
});

test('current chart, detail, daily view and playback share one normalized model', () => {
  assert.match(runtime, /function renderCurrentChart\(/);
  assert.match(runtime, /function renderCurrentDetail\(/);
  assert.match(runtime, /function renderDaily\(/);
  assert.match(runtime, /function renderPlayback\(/);
  assert.match(readModel, /function normalizeCurrent\(/);
  assert.match(readModel, /previous_day_history: previousDayHistory/);
  assert.doesNotMatch(runtime, /dashboard:details/);
  assert.doesNotMatch(readModel, /dashboard-details/);
});

test('current dashboard uses only the materialized dashboard request', () => {
  assert.match(readModel, /fetchJson\('\/api\/dashboard\?history=0'/);
  assert.equal((readModel.match(/\/api\/dashboard\?history=0/g) || []).length, 1);
  assert.doesNotMatch(entry, /dashboard-details-client\.js/);
});
