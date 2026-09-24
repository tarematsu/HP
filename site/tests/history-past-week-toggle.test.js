import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/history/history-past-toggle-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

test('daily history tab is presented as past while explicit weekly and monthly modes remain untouched', () => {
  assert.match(shell, /button\.textContent = '過去'/);
  assert.doesNotMatch(shell, /data-mode="weekly"|data-mode="monthly"/);
});

test('past view mounts a week display checkbox immediately inside the history view', () => {
  assert.match(shell, /view\.prepend\(wrap\)/);
  assert.match(shell, /id="historyPastWeekMode" type="checkbox"/);
  assert.match(shell, />週表示</);
  assert.match(metrics, /history\/history-past-toggle-shell\.js\?v=20260924\.1/);
});

test('past weekly checkbox swaps only the data read model and keeps daily route selected', () => {
  assert.match(runtime, /return state\.mode === 'daily' && state\.pastWeekMode \? 'weekly' : state\.mode/);
  assert.match(runtime, /const mode = dataMode\(\)/);
  assert.match(runtime, /new URLSearchParams\(\{ mode, from, to \}\)/);
  assert.match(runtime, /const selected = button\.dataset\.mode === state\.mode/);
  assert.match(runtime, /toggle\.hidden = state\.mode !== 'daily'/);
  assert.match(runtime, /setPastWeekMode\(Boolean\(event\.currentTarget\.checked\)\)/);
  assert.match(runtime, /publishHistoryData\(mode, data, from, to, cached\)/);
});
