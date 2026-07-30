import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainPage = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const dashboardDaily = readFileSync(new URL('../public/dashboard-daily-summaries.js', import.meta.url), 'utf8');
const dashboardClient = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
const historyPage = readFileSync(new URL('../public/history/index.html', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyFixes = readFileSync(new URL('../public/history/history-page-fixes.js', import.meta.url), 'utf8');
const historyLikes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
const trackEndpoint = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');

 test('main page renders current track likes from the dashboard response', () => {
  assert.match(mainPage, /id="trackBites" hidden/);
  assert.equal((mainPage.match(/<script /g) || []).length, 1);
  assert.match(mainPage, /src="\/dashboard-metrics\.js"/);
  assert.match(dashboardEntry, /import\('\/dashboard-client\.js'\)/);
  assert.match(dashboardClient, /track\.bite_count/);
  assert.match(dashboardClient, /`♡ \$\{integer\.format\(bites\)\}`/);
  assert.equal((dashboardClient.match(/\/api\/dashboard/g) || []).length, 1);
  assert.match(dashboardClient, /payload\.queue/);
  assert.match(dashboardClient, /payload\.history/);
});

test('main page labels member and stream deltas with their actual dates', () => {
  assert.match(dashboardEntry, /renderDashboardDailySummaries/);
  assert.match(dashboardDaily, /formatPeriodLabel\(data\?\.yesterday\?\.period_key, '昨日'\)/);
  assert.match(dashboardDaily, /formatPeriodLabel\(data\?\.day_before_yesterday\?\.period_key, '一昨日'\)/);
  assert.match(dashboardDaily, /`\$\{Number\(match\[2\]\)\}月\$\{Number\(match\[3\]\)\}日`/);
  assert.match(dashboardDaily, /streamsYesterdayDelta', yesterdayLabel/);
  assert.match(dashboardDaily, /streamsDayBeforeDelta', dayBeforeLabel/);
});

test('like ranking reads the current ranking projection directly', () => {
  assert.match(trackEndpoint, /ranking_only/);
  assert.match(trackEndpoint, /loadTrackRanking/);
  assert.match(trackEndpoint, /current_track_like_ranking/);
  assert.match(historyLikes, /ranking_only=1/);
  assert.doesNotMatch(historyLikes, /week_play_count|今週再生/);
});

test('archive removes the track playback tab and its aggregation runtime', () => {
  assert.doesNotMatch(historyPage, /data-mode="tracks"|>再生曲</);
  assert.doesNotMatch(historyEntry, /trackDate|trackWeekMode|'tracks'/);
  assert.doesNotMatch(historyFixes, /aggregateCompleteTrackRows|再生数ランキング|history:track-rows/);
});

test('sparse daily summaries draw visible point markers instead of an empty canvas', () => {
  assert.match(historyFixes, /location\.hash !== '#daily'/);
  assert.match(historyFixes, /state\.lines > 0/);
  assert.match(historyFixes, /this\.arc\(x, y, 3/);
});
