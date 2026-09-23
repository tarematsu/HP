import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainPage = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const historyMain = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyClient = readFileSync(new URL('../public/history/history-client.js', import.meta.url), 'utf8');
const historyData = readFileSync(new URL('../public/history/history-data.js', import.meta.url), 'utf8');
const likesClient = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
const trackHistoryApi = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');
const rankingLibrary = readFileSync(new URL('../functions/lib/track-ranking.js', import.meta.url), 'utf8');
const sakurazakaApi = readFileSync(new URL('../functions/api/sakurazaka46jp.js', import.meta.url), 'utf8');
const broadcastClient = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');

// Keep broad archive/runtime contracts in one static test file so accidental
// endpoint/UI regressions are caught without browser setup.
test('history page keeps its tab/runtime entrypoints', () => {
  assert.match(mainPage, /id="historyView"/);
  assert.match(historyMain, /history-client/);
});

test('history client reduces repeated reads with mode-specific browser session caching', () => {
  assert.match(historyClient, /sessionStorage\.getItem/);
  assert.match(historyClient, /sessionStorage\.setItem/);
  assert.match(historyClient, /historyCacheTtl\(mode\)/);
  assert.match(historyData, /DAILY_HISTORY_CACHE_TTL_MS = 30_000/);
  assert.match(historyData, /DEFAULT_HISTORY_CACHE_TTL_MS = 5 \* 60_000/);
});

test('history tables render newest rows first and paginate only in the browser', () => {
  assert.match(historyClient, /return \[\.\.\.rows\]\.reverse\(\)/);
  assert.match(historyClient, /const PAGE_SIZE = 200/);
  assert.match(historyClient, /state\.visibleRows \+= PAGE_SIZE/);
  assert.match(historyClient, /function exportCsv/);
});

test('integrated likes view reads the materialized ranking without playback counts', () => {
  assert.match(mainPage, /id="likesView"/);
  assert.match(mainPage, /id="likesRankingList"/);
  assert.match(mainPage, /最新いいね/);
  assert.doesNotMatch(mainPage, /今週再生|再生曲/);
  assert.match(likesClient, /\/api\/track-history\?ranking_only=1&ranking_limit=500/);
  assert.match(likesClient, /result\.data\.ranking/);
  assert.match(likesClient, /result\.data\.ranking_summary/);
  assert.match(likesClient, /el\('likesLoad'\)/);
  assert.doesNotMatch(likesClient, /week_play_count|play_count_excluded|currentUtcWeekRange/);
  assert.match(trackHistoryApi, /ranking_only/);
  assert.match(trackHistoryApi, /track-history-status/);
  assert.doesNotMatch(trackHistoryApi, /loadTrackRanking|TRACK_RANKING_SQL|sh_track_ranking_current/);
  assert.match(rankingLibrary, /FROM sh_track_ranking_current/);
  assert.doesNotMatch(rankingLibrary, /FROM sh_track_counter_current/);
});

test('Sakurazaka endpoint and comparison client share one canonical name and direct revisions', () => {
  assert.match(sakurazakaApi, /subject: 'sakurazaka46jp'/);
  assert.match(sakurazakaApi, /cachedSakurazakaSeries/);
  assert.match(broadcastClient, /sakurazaka46jp:v1:/);
  assert.match(broadcastClient, /CACHE_REVISION = '9'/);
});
