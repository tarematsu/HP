import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../site/public/history/history-lite.js', import.meta.url),
  'utf8',
);

test('daily weekly and monthly charts expose listener average extrema and stream totals', () => {
  assert.match(source, /daily: \{[^\n]+chart: '同接・再生数の推移'/);
  assert.match(source, /weekly: \{[^\n]+chart: '同接・再生数の推移'/);
  assert.match(source, /monthly: \{[^\n]+chart: '同接・再生数の推移'/);
  for (const key of ['listener_avg', 'listener_max', 'listener_min', 'stream_end']) {
    assert.match(source, new RegExp(`key: '${key}'`));
  }
  for (const label of ['平均同接', '最大同接', '最小同接', '再生数']) {
    assert.match(source, new RegExp(`label: '${label}'`));
  }
});

test('stream totals use a separate right-hand scale and selected-period detail', () => {
  assert.match(source, /area = \{ left: 58, right: 70/);
  assert.match(source, /streamBounds = chartBounds\(streamValues/);
  assert.match(source, /drawSeries\(streamSeries, streamBounds, \[6, 4\]\)/);
  assert.match(source, /右軸は各期間終了時点の再生数/);
  assert.match(source, /最大同接 \$\{numberText\(row\.listener_max\)\}/);
  assert.match(source, /最小同接 \$\{numberText\(row\.listener_min\)\}/);
  assert.match(source, /再生数 \$\{numberText\(row\.stream_end\)\}/);
});
