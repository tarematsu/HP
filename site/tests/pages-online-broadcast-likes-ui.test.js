import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const likes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
const broadcasts = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
const canvas = readFileSync(new URL('../public/dashboard-chart-canvas.js', import.meta.url), 'utf8');

test('like ranking and track list keep only Sakurazaka46 and unknown artists', () => {
  assert.match(likes, /function includedInLikeRanking/);
  assert.match(likes, /if \(!artist \|\| artist === '—'\) return true/);
  assert.match(likes, /return artist\.normalize\('NFKC'\)\.includes\('櫻坂46'\)/);
  assert.match(likes, /eligibleRankingRows\(\)\.slice\(0, 10\)/);
  assert.match(likes, /const rows = eligibleRankingRows\(\);/);
  assert.match(likes, /rows\.forEach\(\(item, index\) =>/);
  assert.match(likes, /eligibleRankingRows\(\)\.map\(\(row, index\) =>/);
  assert.match(likes, /displayRank = index \+ 1/);
});

test('official listening party graph reuses the shared chart palette and guide-line styling', () => {
  assert.match(broadcasts, /SERIES_COLORS/);
  assert.match(broadcasts, /drawDashboardGrid/);
  assert.match(broadcasts, /drawDashboardLine/);
  assert.match(canvas, /strokeStyle = 'rgba\(31,45,68,\.12\)'/);
  assert.match(broadcasts, /cssColor\('--muted'/);
  assert.doesNotMatch(broadcasts, /#ffffff18|#aaa3b5|hsla\(/);
});
