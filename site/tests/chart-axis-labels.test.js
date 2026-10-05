import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const historyMain = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const axisLabels = readFileSync(new URL('../public/history/history-axis-labels.js', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const currentChart = browserSource('stationhead-channel.js');

test('history runtime installs dedicated axis labels', () => {
  assert.match(historyMain, /history-axis-labels\.js\?v=20260923\.\d+/);
  assert.match(axisLabels, /historyChartAxisTitles/);
  assert.match(axisLabels, /chartYAxisLeft/);
  assert.match(axisLabels, /chartYAxisRight/);
  assert.match(axisLabels, /chartXAxisTitle/);
  assert.match(axisLabels, /history:data-loaded/);
  assert.match(axisLabels, /hashchange/);
  assert.doesNotMatch(axisLabels, /modeTabs'\)\?\.addEventListener\('click'|MutationObserver|createElement\('style'\)/);
});

test('history chart hides duplicate endpoint labels through shared CSS', () => {
  assert.match(sharedCss, /#chartPanel \.chart-axis \{[\s\S]*display: none/);
  assert.match(axisLabels, /endpointAxis\.hidden = true/);
});

test('history axis titles cover summary, ranking, and official listening-party modes', () => {
  assert.match(axisLabels, /daily: \{ left: '同接（人）', right: '再生数増加', x: '期間' \}/);
  assert.match(axisLabels, /weekly: \{ left: '同接（人）', right: '再生数増加', x: '期間' \}/);
  assert.match(axisLabels, /monthly: \{ left: '同接（人）', right: '再生数増加', x: '期間' \}/);
  assert.match(axisLabels, /ranking: \{ left: '順位', right: '', x: '週' \}/);
  assert.match(axisLabels, /broadcasts: \{ left: '同接（人）', right: '', x: '' \}/);
  assert.doesNotMatch(axisLabels, /期間再生数/);
});

test('current 24-hour chart keeps explicit online and bottom axis labels', () => {
  assert.match(currentChart, /fillText\('オンライン数（人）'/);
  assert.match(currentChart, /fillText\('再生数増加'/);
  assert.doesNotMatch(currentChart, /fillText\('コメント\/2分'/);
  assert.match(currentChart, /fillText\('時刻（JST）'/);
});
