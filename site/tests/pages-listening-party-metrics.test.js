import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const likes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
const broadcasts = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');

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

test('official listening party table exposes requested listener, track, estimate, and comment metrics', () => {
  for (const label of ['平均同接', '最小同接', '最大同接', '曲数', '推定再生数', 'コメント数']) {
    assert.match(broadcasts, new RegExp(label));
  }
  assert.match(broadcasts, /Math\.round\(average \* tracks\)/);
  assert.match(broadcasts, /minListener/);
  assert.match(broadcasts, /comment_count/);
  assert.match(broadcasts, /\/api\/host-history\?mode=sessions&limit=500/);
});
