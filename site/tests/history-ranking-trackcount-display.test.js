import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ROUTES } from '../public/dashboard-navigation-config.js';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const history = browserSource('history/history-lite.js');
const leaderboard = browserSource('leaderboard.js');
const leaderboardReadModel = readFileSync(new URL('../public/leaderboard-read-model.js', import.meta.url), 'utf8');
const leaderboardShell = readFileSync(new URL('../public/leaderboard-shell.js', import.meta.url), 'utf8');
const historyShell = readFileSync(new URL('../public/history-shell.js', import.meta.url), 'utf8');
const materialized = readFileSync(new URL('../functions/lib/materialized-history.js', import.meta.url), 'utf8');
const current = readFileSync(new URL('../functions/api/history-current.js', import.meta.url), 'utf8');

test('ranking is owned by the shared leaderboard with the fixed Sakamichi comparison', () => {
  assert.doesNotMatch(entry, /history-ranking-chart\.js|history-ranking-simplified\.js|history-ranking-all-host-table\.js/);
  assert.doesNotMatch(entry, /history-ranking-missing-gap/);
  assert.equal(ROUTES.ranking.viewId, 'leaderboardView');
  assert.equal(ROUTES.ranking.moduleId, 'ranking');
  assert.deepEqual(ROUTES.ranking.loadArgs, { source: 'stationhead' });
  assert.match(leaderboard, /leaderboardReadModel/);
  assert.match(leaderboardReadModel, /const STATIONHEAD_FEATURED = Object\.freeze\(\[[\s\S]*'sakuramankai'[\s\S]*'sakurazaka46jp'[\s\S]*'nogizaka46smej'/);
  assert.match(leaderboardReadModel, /sakuramankai: '#111111'/);
  assert.match(leaderboardReadModel, /sakurazaka46jp: '#d93f79'/);
  assert.match(leaderboardReadModel, /nogizaka46smej: '#812990'/);
  assert.match(leaderboardReadModel, /normalizeStationheadLeaderboard/);
  assert.match(leaderboardShell, /id: 'leaderboardView'/);
  assert.doesNotMatch(historyShell, /id="rankingScope"|id="rankingHost"/);
});

test('shared leaderboard defines the final Stationhead metadata columns directly', () => {
  for (const label of ['週', '順位', 'ホスト', 'チャンネル', 'アーティスト名', '種別']) {
    assert.match(leaderboardReadModel, new RegExp(`label: '${label}'`));
  }
  assert.match(leaderboardReadModel, /relation: relationLabel\(row\)/);
  assert.match(leaderboardReadModel, /row\?\.fandom_type === 'official' \? '公式' : 'ファンダム'/);
  assert.doesNotMatch(leaderboardReadModel, /fandom_label/);
});

test('shared ranking chart paints the known missing band in the same draw pass', () => {
  assert.match(leaderboardReadModel, /from: '2026-01-26', to: '2026-09-14', label: '欠測'/);
  assert.match(leaderboard, /dashboardMissingIndexBands/);
  assert.match(leaderboard, /const hasMissingBand = drawDashboardMissingBands/);
  assert.match(leaderboard, /DASHBOARD_MISSING_KEY/);
  assert.match(leaderboard, /appendLegendEntry\(legend, '欠測', DASHBOARD_MISSING_KEY/);
  assert.match(leaderboard, /drawDashboardLine/);
  assert.doesNotMatch(leaderboard, /DOMNodeInserted|MutationObserver/);
});

test('summary renderer defines only final visible columns and labels track count as 楽曲数', () => {
  assert.doesNotMatch(entry, /history-table-cleanup/);
  const summaryColumns = history.match(/const SUMMARY_COLUMNS = \[[\s\S]*?\n  \];/)?.[0] || '';
  assert.ok(summaryColumns, 'SUMMARY_COLUMNS must be defined at the source renderer');
  assert.match(summaryColumns, /\['sample_count', '取得記録数'/);
  assert.match(summaryColumns, /\['distinct_tracks', '楽曲数'/);
  assert.doesNotMatch(summaryColumns, /likes_max|primary_host|reliable_sample_count|最大いいね|主なホスト|有効記録数/);
  assert.match(history, /const BROADCAST_COLUMNS = \[[\s\S]*\['likes_max', '最大いいね'\]/);
});

test('history read models count total broadcasts from compact Track History R2 day counts', () => {
  assert.match(materialized, /TRACK_HISTORY_DAY_INDEX_KEY/);
  assert.match(materialized, /play_counts/);
  assert.match(materialized, /PAGES_RESPONSE_R2/);
  assert.match(materialized, /trackPeriodKey/);
  assert.doesNotMatch(materialized, /sh_pages_track_history_read_model|json_extract\(row_json|COUNT\(DISTINCT/);
  assert.match(current, /sh_pages_track_history_daily_read_model/);
  assert.match(current, /SELECT play_count AS track_count/);
  assert.doesNotMatch(current, /SUM\(CASE|json_extract\(row_json|FROM sh_pages_track_history_read_model/);
  assert.match(current, /distinct_tracks: trackCount/);
});
