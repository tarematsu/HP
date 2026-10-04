import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const readModel = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');

test('Ohisama and followers chart headers omit update-time pills', () => {
  assert.doesNotMatch(shell, /hinataUpdated|更新時間|JST文字列/);
  assert.doesNotMatch(followersShell, /followersLatestDate/);
  assert.match(route, /hinata-shell\.js\?v=20261001\.2/);
  assert.match(route, /followers-shell\.js\?v=20261001\.1/);
});

test('Ohisama daily rows use the same date-aware shared Canvas runtime as every Stationhead source', () => {
  assert.match(runtime, /function renderDaily\(runtime, payload\)/);
  assert.match(runtime, /Date\.parse\(`\$\{r\.period_key\}T00:00:00Z`\)/);
  assert.match(runtime, /const span = Math\.max\(DAY_MS, maxTime - minTime\)/);
  assert.match(readModel, /\.sort\(\(a, b\) => a\.period_key\.localeCompare\(b\.period_key\)\)/);
  assert.doesNotMatch(runtime, /hinata|ohisama/i);
});
