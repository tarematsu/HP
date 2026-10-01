import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');
const rankingAllHosts = readFileSync(new URL('../public/history/history-ranking-all-host-table.js', import.meta.url), 'utf8');
const rankingSimplified = readFileSync(new URL('../public/history/history-ranking-simplified.js', import.meta.url), 'utf8');
const historyShell = readFileSync(new URL('../public/history-shell.js', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const materialized = readFileSync(new URL('../functions/lib/materialized-history.js', import.meta.url), 'utf8');
const current = readFileSync(new URL('../functions/api/history-current.js', import.meta.url), 'utf8');

test('ranking runtime loads only the fixed Sakamichi comparison presentation', () => {
  assert.match(entry, /history-ranking-chart\.js\?v=20260930\.2&rev=20260930\.3/);
  assert.doesNotMatch(entry, /history-ranking-all-host-table\.js/);
  assert.match(entry, /history-ranking-simplified\.js\?v=20261002\.1/);
  assert.doesNotMatch(entry, /history-ranking-missing-gap/);
  assert.match(entry, /runtimeKey\(mode\)/);
  assert.match(entry, /if \(mode === 'ranking' \|\| mode === 'broadcasts'\) return mode/);
  assert.match(rankingChart, /const FEATURED_HOSTS = \['sakuramankai', 'sakurazaka46jp', 'nogizaka46smej'\]/);
  assert.match(rankingChart, /\['sakuramankai', '#000000'\]/);
  assert.match(rankingChart, /\['sakurazaka46jp', '#d93f79'\]/);
  assert.match(rankingChart, /\['nogizaka46smej', '#812990'\]/);
  assert.match(rankingSimplified, /controls\.hidden = rankingMode/);
  assert.match(rankingSimplified, /moveRankNextToWeek/);
  assert.match(rankingSimplified, /textContent\.trim\(\) === '順位'/);
  assert.match(historyShell, /id=\\"rankingScope\\" type=\\"hidden\\" value=\\"featured\\"/);
  assert.match(historyShell, /id=\\"rankingHost\\" type=\\"hidden\\" value=\\"\\"/);
  assert.doesNotMatch(historyShell, /<option value=\\"all\\">全ホスト<\/option>|placeholder=\\"ホスト名\\"/);
});

test('legacy all-host table module still defines metadata columns for backwards-compatible imports', () => {
  for (const label of ['順位', 'ホスト名', 'チャンネル', 'アーティスト名', '種別', 'ランクイン週数', '平均順位', '最高順位', '最低順位']) {
    assert.match(rankingAllHosts, new RegExp(label));
  }
  assert.match(rankingAllHosts, /\['stationhead_channel_name', 'チャンネル'\]/);
  assert.match(rankingAllHosts, /\['artist_name', 'アーティスト名'\]/);
  assert.match(rankingAllHosts, /\['relation_label', '種別'\]/);
  assert.doesNotMatch(rankingAllHosts, /\['fandom_label', 'ファンダム'\]/);
});

test('legacy all-host table uses shared mobile table presentation', () => {
  assert.match(rankingAllHosts, /EXCLUDED_ALL_HOSTS = new Set\(\['sakuramankai', 'sakurazaka46jp', 'nogizaka46smej'\]\)/);
  assert.match(rankingAllHosts, /\.filter\(\(row\) => !EXCLUDED_ALL_HOSTS\.has\(hostKey\(row\?\.host_name\)\)\)/);
  assert.doesNotMatch(rankingAllHosts, /createElement\('style'\)|nth-child\(1\).*width: 5%|font-size: 8px/);
  assert.match(sharedCss, /#historyView table\.all-host-ranking-table \.ranking-host-button/);
  assert.match(sharedCss, /var\(--dashboard-copy-size\)/);
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
  assert.match(rankingChart, /dashboardMissingIndexBands/);
  assert.match(rankingChart, /const hasMissingBand = drawDashboardMissingBands/);
  assert.match(rankingChart, /DASHBOARD_MISSING_KEY/);
  assert.match(rankingChart, /appendDashboardLegendItem\('欠測', DASHBOARD_MISSING_KEY/);
  assert.match(rankingChart, /history:ranking-chart-drawn/);
  assert.doesNotMatch(rankingChart, /DOMNodeInserted|MutationObserver/);
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
