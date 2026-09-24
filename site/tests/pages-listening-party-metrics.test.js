import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const likes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
const broadcasts = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
const table = readFileSync(new URL('../public/history/history-broadcast-table.js', import.meta.url), 'utf8');
const historyApi = readFileSync(new URL('../functions/api/history.js', import.meta.url), 'utf8');

test('like ranking removes the redundant top-ten/cache status line after loading', () => {
  assert.doesNotMatch(likes, /上位10曲 · 対象/);
  assert.match(likes, /render\(\);\s*setNotice\(''\)/);
  assert.match(likes, /node\.hidden = !text/);
});

test('official listening party lines do not recycle colors across dates', () => {
  assert.match(broadcasts, /const preset = SERIES_COLORS\[index\]/);
  assert.doesNotMatch(broadcasts, /index % SERIES_COLORS\.length/);
  assert.match(broadcasts, /return `hsl\(/);
  assert.match(broadcasts, /const index = series\.indexOf\(item\)/);
});

test('official listening party table exposes final materialized listener, track, estimate, and comment metrics', () => {
  for (const label of ['平均同接', '最小同接', '最大同接', '楽曲数', '推定再生数', 'コメント数']) {
    assert.match(table, new RegExp(label));
  }
  for (const field of ['listener_avg', 'listener_min', 'listener_max', 'distinct_tracks', 'estimated_streams', 'comment_count']) {
    assert.match(historyApi, new RegExp(field));
    assert.match(table, new RegExp(field));
  }
  assert.match(historyApi, /Math\.round\(average \* tracks\)/);
  assert.match(historyApi, /FROM sh_official_broadcast_summary/);
  assert.doesNotMatch(historyApi, /sh_host_station_snapshots|sh_host_broadcast_sessions|sh_official_broadcast_series|json_each/);
  assert.doesNotMatch(broadcasts, /\/api\/host-history|enhanceBroadcastTable|TABLE_METRICS/);
});
