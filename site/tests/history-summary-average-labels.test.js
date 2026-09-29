import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

test('daily weekly and monthly summary cards generate average growth labels directly', () => {
  assert.match(history, /stream: '平均再生増加数'/);
  assert.match(history, /member: '平均メンバー増加数'/);
  assert.match(history, /stream: numberText\(average\(rows, 'stream_growth'\)\)/);
  assert.match(history, /member: numberText\(average\(rows, 'member_growth'\)\)/);
  assert.doesNotMatch(history, /MutationObserver/);
});

test('history entry no longer loads a summary-label correction runtime', () => {
  assert.doesNotMatch(main, /history-summary-average-labels/);
  assert.match(main, /history-lite\.js\?v=20260930\.1/);
  assert.match(tabs, /history-main\.js\?v=20260928\.1/);
  assert.match(metrics, /dashboard-tabs\.js\?v=20260930\.1/);
});
