import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');
const rankingAllHosts = readFileSync(new URL('../public/history/history-ranking-all-host-table.js', import.meta.url), 'utf8');
const tableCleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');
const materialized = readFileSync(new URL('../functions/lib/materialized-history.js', import.meta.url), 'utf8');
const current = readFileSync(new URL('../functions/api/history-current.js', import.meta.url), 'utf8');

test('ranking chart keeps featured comparison and supports one selected all-host series', () => {
  assert.match(entry, /history-ranking-chart\.js\?v=20260923\.8/);
  assert.match(entry, /history-ranking-all-host-table\.js\?v=20260923\.3/);
  assert.doesNotMatch(entry, /history-ranking-missing-gap/);
  assert.match(entry, /runtimeKey\(mode\)/);
  assert.match(entry, /if \(mode === 'ranking' \|\| mode === 'broadcasts'\) return mode/);
  assert.match(rankingChart, /const FEATURED_HOSTS = \['sakuramankai', 'sakurazaka46jp'\]/);
  assert.match(rankingChart, /\['sakuramankai', '#000000'\]/);
  assert.match(rankingChart, /\['sakurazaka46jp', '#d93f79'\]/);
  assert.match(rankingChart, /detail\.data\.chart_hosts/);
  assert.match(rankingChart, /history:ranking-host-selected/);
  assert.match(rankingChart, /if \(chartHosts\.length === 1\) return '#000000'/);
  assert.match(rankingChart, /chartHosts\.length === 1 \? 'single-host' : 'featured-hosts'/);
  assert.match(rankingChart, /週間リーダーボード順位/);
  assert.match(rankingChart, /順位推移/);
  assert.doesNotMatch(rankingChart, /previousFetch|browser\.fetch|response\.clone\(\)\.json/);
});

test('all-host table exposes channel, artist, and relation after host and supports tap selection', () => {
  for (const label of ['順位', 'ホスト名', 'チャンネル', 'アーティスト名', '公式', 'ランクイン週数', '平均順位', '最高順位', '最低順位']) {
    assert.match(rankingAllHosts, new RegExp(label));
  }
  assert.match(rankingAllHosts, /\['stationhead_channel_name', 'チャンネル'\]/);
  assert.match(rankingAllHosts, /\['artist_name', 'アーティスト名'\]/);
  assert.match(rankingAllHosts, /\['relation_label', '公式'\]/);
  assert.doesNotMatch(rankingAllHosts, /\['fandom_label', 'ファンダム'\]/);
  assert.match(rankingAllHosts, /data\.host_rankings/);
  assert.match(rankingAllHosts, /button\.dataset\.rankingHost/);
  assert.match(rankingAllHosts, /history:ranking-host-selected/);
  assert.match(rankingAllHosts, /setSelectedHost\(defaultHost\)/);
});

test('all-host table excludes the two featured hosts and fits nine columns on mobile', () => {
  assert.match(rankingAllHosts, /EXCLUDED_ALL_HOSTS = new Set\(\['sakuramankai', 'sakurazaka46jp'\]\)/);
  assert.match(rankingAllHosts, /\.filter\(\(row\) => !EXCLUDED_ALL_HOSTS\.has\(hostKey\(row\?\.host_name\)\)\)/);
  for (const [column, width] of [[1, 5], [2, 17], [3, 14], [4, 18], [5, 10], [6, 10], [7, 9], [8, 9], [9, 8]]) {
    assert.match(rankingAllHosts, new RegExp(`th:nth-child\\(${column}\\),[\\s\\S]*td:nth-child\\(${column}\\) \\{ width: ${width}% !important; \\}`));
  }
  assert.match(rankingAllHosts, /font-size: 8px !important/);
  assert.match(rankingAllHosts, /padding-left: 2px !important/);
  assert.match(rankingAllHosts, /text-overflow: clip !important/);
});

test('ranking chart fills missing weeks and paints the missing band in the same draw pass', () => {
  assert.match(rankingChart, /const MISSING_START = '2026-01-26'/);
  assert.match(rankingChart, /const MISSING_END = '2026-09-14'/);
  assert.match(rankingChart, /const sourceRows = rows\.filter/);
  assert.match(rankingChart, /const sourceWeeks = \[\.\.\.new Set\(sourceRows\.map/);
  assert.match(rankingChart, /const firstWeek = sourceWeeks\[0\]/);
  assert.match(rankingChart, /rankingWeeks\.map\(isoDate\)\.filter\(\(week\) => week && week >= firstWeek\)/);
  assert.doesNotMatch(rankingChart, /weeklyRange|mondayOnOrAfter|mondayOnOrBefore|rankingFrom|rankingTo/);
  assert.match(rankingChart, /function fullWeek\(value\)/);
  assert.match(rankingChart, /function drawMissingBand\(context, weeks, positions, area\)/);
  assert.match(rankingChart, /const hasMissingBand = drawMissingBand\(context, model\.weeks, positions, area\)/);
  assert.match(rankingChart, /context\.fillStyle = 'rgba\(100, 107, 116, \.16\)'/);
  assert.match(rankingChart, /appendLegend\('欠測', 'rgba\(100, 107, 116, \.55\)'/);
  assert.match(rankingChart, /history:ranking-chart-drawn/);
  assert.doesNotMatch(rankingChart, /DOMNodeInserted|MutationObserver/);
});

test('summary tables remove maximum likes and primary host while retaining track count', () => {
  assert.match(entry, /history-table-cleanup\.js/);
  assert.match(tableCleanup, /最大いいね/);
  assert.match(tableCleanup, /主なホスト/);
  assert.doesNotMatch(tableCleanup, /曲数/);
});

test('history read models count total broadcasts including repeated tracks', () => {
  assert.match(materialized, /sh_pages_track_history_read_model/);
  assert.match(materialized, /SUM\(CASE/);
  assert.match(materialized, /json_extract\(row_json,'\$\.play_count'\)/);
  assert.match(materialized, /ELSE 1/);
  assert.doesNotMatch(materialized, /COUNT\(DISTINCT/);
  assert.match(materialized, /strftime\('%w',play_date\)/);
  assert.match(materialized, /substr\(play_date,1,7\)/);
  assert.match(current, /sh_pages_track_history_read_model/);
  assert.match(current, /SUM\(CASE/);
  assert.match(current, /json_extract\(row_json,'\$\.play_count'\)/);
  assert.match(current, /distinct_tracks: trackCount/);
});
