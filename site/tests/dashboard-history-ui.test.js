import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainPage = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const stationheadRuntime = browserSource('stationhead-channel.js');
const stationheadReadModel = browserSource('stationhead-channel-read-model.js');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyClient = browserSource('history/history-lite.js');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const historyLikes = browserSource('stationhead/likes.js');
const trackEndpoint = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');

test('shared Stationhead current view renders track likes from each read model queue', () => {
  assert.match(stationheadShell, /role\('track-bites'\)/);
  assert.match(stationheadRuntime, /track\?\.bite_count/);
  assert.match(stationheadRuntime, /`♡ \$\{numberText\(value\)\}`/);
  assert.match(stationheadReadModel, /queue: Array\.isArray\(payload\?\.queue\) \? payload\.queue : \[\]/);
  assert.equal((mainPage.match(/<script /g) || []).length, 1);
  assert.match(mainPage, /src="\/assets\/dashboard\.min\.js\?v=[^"']+"/);
});

test('shared Stationhead history table uses the actual daily period key and cumulative boundaries', () => {
  assert.match(stationheadShell, /<th>日付<\/th><th>平均同接<\/th>/);
  assert.match(stationheadShell, /<th>開始再生<\/th><th>終了再生<\/th><th>増加<\/th>/);
  assert.match(stationheadRuntime, /row\.period_key \|\| '—'/);
  assert.match(stationheadReadModel, /period_key: String\(row\?\.period_key \|\| ''\)/);
  assert.match(stationheadReadModel, /stream_start: finite\(row\?\.stream_start\)/);
  assert.match(stationheadReadModel, /stream_end: finite\(row\?\.stream_end\)/);
  assert.match(stationheadReadModel, /member_start: finite\(row\?\.member_start\)/);
  assert.match(stationheadReadModel, /member_end: finite\(row\?\.member_end\)/);
});

test('shared Stationhead likes panel is backed by the R2 materialized track model', () => {
  assert.match(browserSource('stationhead-channel-read-model.js'), /ranking_only=1/); assert.match(browserSource('stationhead/likes.js'), /runtime.likes/); assert.doesNotMatch(browserSource('stationhead/likes.js'), /weekly_plays|play_count/);
});

test('archive removes the track playback tab and its aggregation runtime', () => {
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
