import { browserSource } from './helpers/dashboard-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const likes = browserSource('stationhead/likes.js');
const broadcasts = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
const canvas = readFileSync(new URL('../public/dashboard-chart-canvas.js', import.meta.url), 'utf8');

test('like ranking and track list keep only Sakurazaka46 and unknown artists', () => {
  const adapter=browserSource('stationhead/buddies-read-model.js'); assert.match(adapter,/artist_filter/); assert.match(adapter,/櫻坂46/); assert.match(adapter,/normalizeLikes/); const renderer=browserSource('stationhead/likes.js'); assert.match(renderer,/runtime.likes.slice\(0, 10\)/); assert.match(renderer,/runtime.likes.forEach/); assert.match(renderer,/runtime.likes.map/);
});

test('official listening party graph reuses the shared chart palette and guide-line styling', () => {
  assert.match(broadcasts, /SERIES_COLORS/);
  assert.match(broadcasts, /drawDashboardGrid/);
  assert.match(broadcasts, /drawDashboardLine/);
  assert.match(canvas, /strokeStyle = 'rgba\(31,45,68,\.12\)'/);
  assert.match(broadcasts, /cssColor\('--muted'/);
  assert.doesNotMatch(broadcasts, /#ffffff18|#aaa3b5|hsla\(/);
});


test('like list keeps only rank, track, like count and checked time columns', () => {
  const shell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
  assert.match(shell, /<th>順位<\/th><th>曲名<\/th><th>いいね数<\/th><th>確認時間<\/th>/);
  assert.doesNotMatch(shell, /<th>アーティスト<\/th><th>最新いいね数<\/th><th>最終取得<\/th>/);
  assert.match(likes, /appendEmptyTableRow\(body, 'いいねデータがありません。', 4\)/);
  assert.match(likes, /appendTableRow\(body, \[index \+ 1, row\.title \|\| '曲名不明', numberText\(row\.like_count\),/);
  assert.match(likes, /\[\['順位', '曲名', 'いいね数', '確認時間'\]/);
});
