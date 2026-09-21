import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const daily = readFileSync(new URL('../public/dashboard-daily-summaries.js', import.meta.url), 'utf8');
const likes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
const broadcasts = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');

test('current online card uses the requested label and three daily averages without the 24h range', () => {
  assert.match(daily, /オンライン数/);
  assert.match(daily, /onlineYesterdayAvg/);
  assert.match(daily, /onlineDayBeforeAvg/);
  assert.match(daily, /onlineThreeDaysAgoAvg/);
  assert.match(daily, /removeOnlineRange/);
  assert.match(daily, /getElementById\('online24h'\)\?\.remove\(\)/);
});

test('like ranking excludes Sakurazaka46 and unknown artists before taking the top ten', () => {
  assert.match(likes, /function includedInLikeRanking/);
  assert.match(likes, /artist === '—'/);
  assert.match(likes, /includes\('櫻坂46'\)/);
  assert.match(likes, /eligibleRankingRows\(\)\.slice\(0, 10\)/);
  assert.match(likes, /displayRank = index \+ 1/);
});

test('official listening party graph reuses the shared chart palette and guide-line styling', () => {
  assert.match(broadcasts, /SERIES_COLORS/);
  assert.match(broadcasts, /rgba\(31,45,68,\.12\)/);
  assert.match(broadcasts, /cssColor\('--muted'/);
  assert.doesNotMatch(broadcasts, /#ffffff18|#aaa3b5|hsla\(/);
});
