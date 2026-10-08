import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ROUTES } from '../public/dashboard-navigation-config.js';

const tabsSource = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const leaderboardSource = browserSource('leaderboard.js');
const leaderboardModel = readFileSync(new URL('../public/leaderboard-read-model.js', import.meta.url), 'utf8');

test('shared leaderboard model classifies the known collection gap and genuine out-of-rank weeks', () => {
  assert.match(leaderboardModel, /from: '2026-01-26', to: '2026-09-14', label: '欠測'/);
  assert.match(leaderboardModel, /if \(stationheadMissingPeriod\(period\)\) return '欠測'/);
  assert.match(leaderboardModel, /if \(row\?\.synthetic \|\| row\?\.is_out_of_rank\) return '圏外'/);
  assert.match(leaderboardModel, /if \(rank != null\) return ''/);
});

test('shared leaderboard model omits missing and out-of-rank rows from the visible table', () => {
  assert.match(leaderboardModel, /const rows = timelineRows\.filter\(\(row\) => row\.rank_status !== '欠測' && row\.rank_status !== '圏外'\)/);
  assert.match(leaderboardModel, /rank_status: stationheadRankStatus\(period, rank, row\)/);
  assert.match(leaderboardSource, /row\?\.rank_status \|\| '圏外'/);
});

test('shared leaderboard replaces the history table-status lazy hook', () => {
  assert.doesNotMatch(tabsSource, /history-ranking-table-status|ranking-status/);
  assert.equal(ROUTES.ranking.viewId, 'leaderboardView');
  assert.deepEqual(ROUTES.ranking.loadArgs, { source: 'stationhead' });
  assert.match(leaderboardSource, /leaderboardReadModel\(source\)\.load/);
  assert.match(leaderboardModel, /normalizeStationheadLeaderboard/);
  assert.doesNotMatch(leaderboardSource, /MutationObserver|queueMicrotask/);
});
