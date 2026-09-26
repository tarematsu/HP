import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/history/history-past-toggle-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');

test('daily history tab stays 日次 without weekly and monthly top tabs', () => {
  assert.match(html, /data-mode="daily">日次<\/button>/);
  assert.doesNotMatch(shell, /button\.textContent = '過去'|renameDailyTab/);
  assert.doesNotMatch(shell, /data-mode="weekly"|data-mode="monthly"/);
});

test('daily view mounts its weekly checkbox only with the history runtime', () => {
  assert.match(shell, /rangePresets\.append\(wrap\)/);
  assert.match(shell, /id="historyPastWeekMode" type="checkbox"/);
  assert.match(shell, />週次</);
  assert.match(historyEntry, /history\/history-past-toggle-shell\.js\?v=20260927\.1/);
  assert.doesNotMatch(metrics, /history\/history-past-toggle-shell\.js/);
});

test('weekly checkbox swaps only the data read model and keeps daily route selected', () => {
  assert.match(runtime, /return state\.mode === 'daily' && state\.pastWeekMode \? 'weekly' : state\.mode/);
  assert.match(runtime, /const mode = dataMode\(\)/);
  assert.match(runtime, /new URLSearchParams\(\{ mode, from, to \}\)/);
  assert.match(runtime, /const selected = button\.dataset\.mode === state\.mode/);
  assert.match(runtime, /toggle\.hidden = state\.mode !== 'daily'/);
  assert.match(runtime, /setPastWeekMode\(Boolean\(event\.currentTarget\.checked\)\)/);
  assert.match(runtime, /publishHistoryData\(mode, data, from, to, cached\)/);
});
