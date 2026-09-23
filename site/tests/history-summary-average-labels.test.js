import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const labels = readFileSync(new URL('../public/history/history-summary-average-labels.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

test('daily weekly and monthly summary cards use average growth labels', () => {
  assert.match(labels, /new Set\(\['daily', 'weekly', 'monthly'\]\)/);
  assert.match(labels, /streamLabel: '平均再生数'/);
  assert.match(labels, /memberLabel: '平均メンバー増加数'/);
  assert.match(labels, /history:data-loaded/);
  assert.match(labels, /MutationObserver/);
});

test('average-label runtime is loaded with the current shared dashboard deployment version', () => {
  assert.match(main, /history-summary-average-labels\.js\?v=20260923\.1/);
  assert.match(tabs, /history-main\.js\?v=20260923\.9/);
  assert.match(metrics, /dashboard-tabs\.js\?v=20260923\.8/);
});
