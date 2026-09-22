import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');
const rankingMissing = readFileSync(new URL('../public/history/history-ranking-missing-gap.js', import.meta.url), 'utf8');
const tableCleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');
const materialized = readFileSync(new URL('../functions/lib/materialized-history.js', import.meta.url), 'utf8');
const current = readFileSync(new URL('../functions/api/history-current.js', import.meta.url), 'utf8');

test('ranking renders a two-host leaderboard chart', () => {
  assert.match(entry, /history-ranking-chart\.js\?v=20260923\.2/);
  assert.match(rankingChart, /const HOSTS = \['sakuramankai', 'sakurazaka46jp'\]/);
  assert.match(rankingChart, /週間リーダーボード順位/);
  assert.match(rankingChart, /panel\.hidden = false/);
  assert.match(rankingChart, /順位は上ほど高順位/);
});

test('ranking uses a complete Monday timeline and keeps the table ranked-only', () => {
  assert.match(entry, /history-ranking-missing-gap\.js\?v=20260923\.2/);
  assert.match(rankingChart, /function weeklyRange\(from, to\)/);
  assert.match(rankingChart, /mondayOnOrAfter/);
  assert.match(rankingChart, /mondayOnOrBefore/);
  assert.match(rankingChart, /rankingFrom = isoDate\(url\.searchParams\.get\('from'\)\)/);
  assert.match(rankingChart, /rankingTo = isoDate\(url\.searchParams\.get\('to'\)\)/);
  assert.match(rankingChart, /\.\.\.weeklyRange\(rangeStart, rangeEnd\)/);
  assert.match(rankingChart, /function fullWeek\(value\)/);
  assert.match(rankingChart, /context\.textAlign = first \? 'left' : last \? 'right' : 'center'/);
  assert.match(rankingChart, /first \? x \+ 2 : last \? x - 2 : x/);
  assert.match(rankingChart, /history:ranking-chart-drawn/);
  assert.match(rankingMissing, /MISSING_START = '2026-01-26'/);
  assert.match(rankingMissing, /MISSING_END = '2026-09-14'/);
  assert.match(rankingMissing, /function completeWeeks\(\)/);
  assert.match(rankingMissing, /renderedWeeks\.length/);
  assert.match(rankingMissing, /\.\.\.weeklyRange\(from, to\)/);
  assert.match(rankingMissing, /fillText\('欠測'/);
  assert.match(rankingMissing, /空白週は圏外です/);
  assert.match(rankingMissing, /history:ranking-chart-drawn/);
  assert.match(rankingMissing, /scheduleOverlay\(0\)/);
  assert.match(rankingMissing, /keepRankedRowsOnly/);
  assert.match(rankingMissing, /\^#\?\\d\+\$/);
  assert.match(rankingMissing, /if \(!hasNumericRank\(row\)\) row\.remove\(\)/);
  assert.doesNotMatch(rankingMissing, /createMissingRow/);
  assert.doesNotMatch(rankingMissing, /clearRect\(area\.left/);
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
