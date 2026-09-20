import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');
const tableCleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');
const materialized = readFileSync(new URL('../functions/lib/materialized-history.js', import.meta.url), 'utf8');
const current = readFileSync(new URL('../functions/api/history-current.js', import.meta.url), 'utf8');

test('ranking renders a two-host leaderboard chart', () => {
  assert.match(entry, /history-ranking-chart\.js/);
  assert.match(rankingChart, /const HOSTS = \['sakuramankai', 'sakurazaka46jp'\]/);
  assert.match(rankingChart, /週間リーダーボード順位/);
  assert.match(rankingChart, /panel\.hidden = false/);
  assert.match(rankingChart, /順位は上ほど高順位/);
});

test('summary tables remove maximum likes and primary host while retaining track count', () => {
  assert.match(entry, /history-table-cleanup\.js/);
  assert.match(tableCleanup, /最大いいね/);
  assert.match(tableCleanup, /主なホスト/);
  assert.doesNotMatch(tableCleanup, /曲数/);
});

test('history read models compute unique tracks from canonical track keys', () => {
  assert.match(materialized, /sh_pages_track_history_read_model/);
  assert.match(materialized, /COUNT\(DISTINCT COALESCE\(NULLIF\(json_extract\(row_json,'\$\.track_key'\)/);
  assert.match(materialized, /strftime\('%w',play_date\)/);
  assert.match(materialized, /substr\(play_date,1,7\)/);
  assert.match(current, /sh_pages_track_history_read_model/);
  assert.match(current, /distinct_tracks: distinctTracks/);
});
