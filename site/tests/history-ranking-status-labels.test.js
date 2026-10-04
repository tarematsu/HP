import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const statusSource = readFileSync(
  new URL('../public/history/history-ranking-table-status.js', import.meta.url),
  'utf8',
);
const tabsSource = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const leaderboardSource = readFileSync(new URL('../public/leaderboard.js', import.meta.url), 'utf8');
const leaderboardModel = readFileSync(new URL('../public/leaderboard-read-model.js', import.meta.url), 'utf8');

test('legacy leaderboard status helper still classifies the known collection gap and genuine out-of-rank weeks', () => {
  assert.match(statusSource, /MISSING_START = '2026-01-26'/);
  assert.match(statusSource, /MISSING_END = '2026-09-14'/);
  assert.match(statusSource, /week >= MISSING_START && week <= MISSING_END\) return '欠測'/);
  assert.match(statusSource, /row\?\.synthetic \|\| row\?\.is_out_of_rank\) return '圏外'/);
  assert.match(statusSource, /finiteRank\(row\?\.rank\) != null\) return ''/);
});

test('legacy leaderboard list helper hides missing and out-of-rank rows while keeping ranked rows', () => {
  assert.match(statusSource, /headers\.indexOf\('週'\)/);
  assert.match(statusSource, /headers\.indexOf\('ホスト'\)/);
  assert.match(statusSource, /headers\.indexOf\('順位'\)/);
  assert.match(statusSource, /status === '欠測' \|\| status === '圏外'/);
  assert.match(statusSource, /row\.remove\(\)/);
  assert.doesNotMatch(statusSource, /cells\[rankIndex\]\.textContent = status/);
  assert.match(statusSource, /queueMicrotask\(\(\) => queueMicrotask\(hideNonRankedRows\)\)/);
});

test('shared leaderboard replaces the history table-status lazy hook', () => {
  assert.doesNotMatch(tabsSource, /history-ranking-table-status|ranking-status/);
  assert.match(tabsSource, /ranking:\s*\{[\s\S]*viewId: 'leaderboardView'[\s\S]*leaderboard\.js[\s\S]*source: 'stationhead'/);
  assert.match(leaderboardSource, /leaderboardReadModel\(source\)\.load/);
  assert.match(leaderboardModel, /normalizeStationheadLeaderboard/);
});
