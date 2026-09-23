import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const statusSource = readFileSync(
  new URL('../public/history/history-ranking-table-status.js', import.meta.url),
  'utf8',
);
const tabsSource = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');

test('leaderboard still classifies the known collection gap and genuine out-of-rank weeks', () => {
  assert.match(statusSource, /MISSING_START = '2026-01-26'/);
  assert.match(statusSource, /MISSING_END = '2026-09-14'/);
  assert.match(statusSource, /week >= MISSING_START && week <= MISSING_END\) return '欠測'/);
  assert.match(statusSource, /row\?\.synthetic \|\| row\?\.is_out_of_rank\) return '圏外'/);
  assert.match(statusSource, /finiteRank\(row\?\.rank\) != null\) return ''/);
});

test('leaderboard list hides missing and out-of-rank rows while keeping ranked rows', () => {
  assert.match(statusSource, /headers\.indexOf\('週'\)/);
  assert.match(statusSource, /headers\.indexOf\('ホスト'\)/);
  assert.match(statusSource, /headers\.indexOf\('順位'\)/);
  assert.match(statusSource, /status === '欠測' \|\| status === '圏外'/);
  assert.match(statusSource, /row\.remove\(\)/);
  assert.doesNotMatch(statusSource, /cells\[rankIndex\]\.textContent = status/);
  assert.match(statusSource, /queueMicrotask\(\(\) => queueMicrotask\(hideNonRankedRows\)\)/);
});

test('ranking list filter stays lazy and loads before the history data request', () => {
  assert.match(tabsSource, /history-ranking-table-status\.js\?v=20260923\.2/);
  assert.match(tabsSource, /if \(mode === 'ranking'\) await loadRankingStatusRuntime\(\);\n    await loadHistoryRuntime\(\);/);
});
