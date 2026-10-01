import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainPage = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const likesShell = readFileSync(new URL('../public/likes-shell.js', import.meta.url), 'utf8');
const tabRegistry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const dashboardDaily = readFileSync(new URL('../public/dashboard-daily-summaries.js', import.meta.url), 'utf8');
const dashboardClient = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
const dashboardChart = readFileSync(new URL('../public/dashboard-chart-comparison.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyClient = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const historyLikes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
const trackEndpoint = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');

test('main page renders current track likes from the dashboard response', () => {
  assert.match(currentShell, /id="trackBites" hidden/);
  assert.equal((mainPage.match(/<script /g) || []).length, 1);
  assert.match(mainPage, /src="\/assets\/dashboard\.min\.js\?v=[^"']+"/);
  assert.match(dashboardEntry, /import\('\/dashboard-client\.js\?v=[^']+'\)/);
  assert.match(dashboardClient, /track\.bite_count/);
  assert.match(dashboardClient, /`♡ \$\{integer\.format\(bites\)\}`/);
  assert.equal((dashboardClient.match(/\/api\/dashboard/g) || []).length, 1);
  assert.match(dashboardClient, /payload\.queue/);
  assert.match(dashboardChart, /dashboard:payload/);
  assert.doesNotMatch(dashboardChart, /dashboard:details/);
});

test('main page labels member and stream deltas with their actual dates', () => {
  assert.match(dashboardEntry, /dashboard-daily-summaries\.js\?v=20260930\.2/);
  assert.match(dashboardDaily, /renderDashboardDailySummaries/);
  assert.match(dashboardDaily, /dashboard:payload/);
  assert.match(dashboardDaily, /const data = event\?\.detail\?\.payload\?\.daily_summaries/);
  assert.match(dashboardDaily, /formatPeriodLabel\(data\?\.yesterday\?\.period_key, '昨日'\)/);
  assert.match(dashboardDaily, /formatPeriodLabel\(data\?\.day_before_yesterday\?\.period_key, '一昨日'\)/);
  assert.match(dashboardDaily, /`\$\{Number\(match\[2\]\)\}月\$\{Number\(match\[3\]\)\}日`/);
  assert.match(dashboardDaily, /streamsYesterdayDelta', yesterdayLabel/);
  assert.match(dashboardDaily, /streamsDayBeforeDelta', dayBeforeLabel/);
});

test('like ranking is an integrated view backed by the R2 materialized service', () => {
  assert.match(likesShell, /id: 'likesView'/);
  assert.match(likesShell, /className: 'likes-view'/);
  assert.match(likesShell, /id="likesRankingList"/);
  assert.match(tabRegistry, /view: 'likes', mode: 'likes', label: 'いいね'/);
  assert.match(trackEndpoint, /PAGES_READ_MODEL_SERVICE/);
  assert.match(trackEndpoint, /url\.searchParams\.set\('key', TRACK_HISTORY_MODEL_KEY\)/);
  assert.match(trackEndpoint, /url\.searchParams\.set\('api', '1'\)/);
  assert.match(trackEndpoint, /url\.searchParams\.append\(name, value\)/);
  assert.doesNotMatch(trackEndpoint, /MINUTE_DB|loadTrackRanking|TRACK_RANKING_SQL|sh_track_ranking_current|\.prepare\(/);
  assert.match(historyLikes, /ranking_only=1/);
  assert.match(historyLikes, /likesRankingList/);
  assert.doesNotMatch(historyLikes, /likesLoad|week_play_count|今週再生/);
});

test('archive removes the track playback tab and its aggregation runtime', () => {
  assert.doesNotMatch(tabRegistry, /mode: 'tracks'|label: '再生曲'/);
  assert.doesNotMatch(historyEntry, /trackDate|trackWeekMode|'tracks'/);
  assert.doesNotMatch(historyClient, /aggregateCompleteTrackRows|再生数ランキング|history:track-rows/);
});

test('sparse daily summaries draw visible point markers through the shared canvas renderer', () => {
  assert.match(periodChart, /drawDashboardLine/);
  assert.match(periodChart, /mode === 'daily' && lineCount === 0/);
  assert.match(periodChart, /context\.arc\(positions\[index\], listenerY\(value\), 3/);
  assert.match(periodChart, /context\.fill\(\)/);
  assert.doesNotMatch(historyClient, /CanvasRenderingContext2D\.prototype|beginPathWithDailyPoints|strokeWithDailyPoints/);
});
