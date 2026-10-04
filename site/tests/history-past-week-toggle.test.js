import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/history/history-past-toggle-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');

test('history tab stays 過去 without weekly and monthly top tabs', () => {
  assert.match(stationheadModel, /value: 'history', label: '過去'/);
  assert.doesNotMatch(shell, /button\.textContent = '過去'|renameDailyTab/);
  assert.doesNotMatch(stationheadModel, /value: 'weekly'|value: 'monthly'/);
  assert.doesNotMatch(shell, /data-mode="weekly"|data-mode="monthly"/);
});

test('daily view replaces the CSV action with daily and weekly data controls', () => {
  assert.match(shell, /const csv = document\.getElementById\('csv'\)/);
  assert.match(shell, /csv\.replaceWith\(wrap\)/);
  assert.match(shell, /id="historyPastWeekMode" type="checkbox" hidden/);
  assert.match(shell, /data-history-past-mode="daily"[^>]*>日次</);
  assert.match(shell, /data-history-past-mode="weekly"[^>]*>週次</);
  assert.match(shell, /'週次データ' : '日次データ'/);
  assert.doesNotMatch(shell, /rangePresets\.append\(wrap\)/);
  assert.match(historyEntry, /history\/history-past-toggle-shell\.js\?v=20261001\.2/);
  assert.doesNotMatch(metrics, /history\/history-past-toggle-shell\.js/);
});

test('daily and weekly buttons swap only the data read model and keep daily route selected', () => {
  assert.match(runtime, /return state\.mode === 'daily' && state\.pastWeekMode \? 'weekly' : state\.mode/);
  assert.match(runtime, /const mode = dataMode\(\)/);
  assert.match(runtime, /new URLSearchParams\(\{ mode, from, to \}\)/);
  assert.match(runtime, /const selected = button\.dataset\.mode === state\.mode/);
  assert.match(runtime, /toggle\.hidden = state\.mode !== 'daily'/);
  assert.match(runtime, /setPastWeekMode\(Boolean\(event\.currentTarget\.checked\)\)/);
  assert.match(runtime, /publishHistoryData\(mode, data, from, to, cached\)/);
  assert.match(shell, /checkbox\.dispatchEvent\(new Event\('change'/);
});
