import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const historyClient = readFileSync(
  new URL('../site/public/history/history-lite.js', import.meta.url),
  'utf8',
);
const chart = readFileSync(
  new URL('../site/public/history/history-period-chart.js', import.meta.url),
  'utf8',
);

test('daily weekly and monthly charts expose listener average extrema and stream growth', () => {
  assert.match(historyClient, /daily: \{[^\n]+chart: '同接・再生数の推移'/);
  assert.match(historyClient, /weekly: \{[^\n]+chart: '同接・再生数の推移'/);
  assert.match(historyClient, /monthly: \{[^\n]+chart: '同接・再生数の推移'/);
  for (const key of ['listener_avg', 'listener_max', 'listener_min']) {
    assert.match(chart, new RegExp(`key: '${key}'`));
  }
  assert.match(chart, /row\?\.stream_growth/);
  for (const label of ['平均同接', '最大同接', '最小同接', '期間再生数']) {
    assert.match(chart, new RegExp(label));
  }
  assert.match(chart, /history:data-loaded/);
});

test('stream growth uses a separate right-hand scale with bars and selected-period detail', () => {
  assert.match(chart, /area = \{ left: 58, right: 70/);
  assert.match(chart, /streamCeiling/);
  assert.match(chart, /streamY/);
  assert.match(chart, /fillRect\(/);
  assert.match(chart, /期間再生数 \$\{finite\(row\.stream_growth\)/);
  assert.match(chart, /最大同接 \$\{integer\.format/);
  assert.match(chart, /最小同接 \$\{integer\.format/);
  assert.doesNotMatch(chart, /stream_end|drawSeries\(streamSeries/);
});
