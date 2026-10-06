import { browserSource } from './helpers/dashboard-source.js';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { ROUTES } from '../public/dashboard-navigation-config.js';

const mainPage = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');
const tabsClient = dashboardRouterSource();
const historyShell = readFileSync(new URL('../public/history-shell.js', import.meta.url), 'utf8');
const likesShell = browserSource('stationhead-channel-shell.js');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyClient = browserSource('history/history-lite.js');
const historyData = readFileSync(new URL('../public/history/history-data-client.js', import.meta.url), 'utf8');
const historyStyles = readFileSync(new URL('../public/history/history-lite.css', import.meta.url), 'utf8');
const mainStyles = readFileSync(new URL('../public/app-lite.css', import.meta.url), 'utf8');
const navigationStyles = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const likesClient = browserSource('stationhead/likes.js');
const broadcastClient = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const trackHistoryApi = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');
const rankingLibrary = readFileSync(new URL('../functions/lib/track-ranking.js', import.meta.url), 'utf8');
const sakurazakaApi = readFileSync(new URL('../functions/api/sakurazaka46jp.js', import.meta.url), 'utf8');
const middleware = readFileSync(new URL('../functions/_middleware.js', import.meta.url), 'utf8');

const INTERNAL_ARCHIVE_MODES = ['daily', 'weekly', 'monthly', 'broadcasts'];

test('main dashboard exposes shared Buddies archive and leaderboard functions', () => {
  assert.match(stationheadModel, /value: 'history', label: '過去'/);
  assert.match(stationheadModel, /value: 'likes', label: 'いいね'/);
  assert.match(stationheadModel, /value: 'broadcasts', label: 'リスパ'/);
  assert.doesNotMatch(stationheadModel, /value: '(?:weekly|monthly|ranking|tracks)'/);
  assert.match(tabsClient, /mode: 'ranking', label: 'リーダーボード'/);
  assert.equal(ROUTES.ranking.viewId, 'leaderboardView');
  assert.deepEqual(ROUTES.ranking.loadArgs, { source: 'stationhead' });
  assert.equal(existsSync(new URL('../public/history/index.html', import.meta.url)), false);
  assert.equal(existsSync(new URL('../public/history/likes/index.html', import.meta.url)), false);
});

test('weekly and monthly summary modes remain internal after their top tabs are removed', () => {
  assert.doesNotMatch(stationheadModel, /value: 'weekly'|value: 'monthly'/);
  assert.match(historyClient, /weekly: \{/);
  assert.match(historyClient, /monthly: \{/);
});

test('embedded history excludes leaderboard and lazy-loads only archive runtimes', () => {
  assert.match(historyEntry, /const SUMMARY_MODES = new Set\(\['daily', 'weekly', 'monthly'\]\)/);
  assert.match(historyEntry, /const VALID_MODES = new Set\(\[\.\.\.SUMMARY_MODES, 'broadcasts'\]\)/);
  assert.doesNotMatch(historyEntry, /'ranking'|history-ranking-chart|history-ranking-simplified/);
  assert.doesNotMatch(historyEntry, /'tracks'/);
  assert.match(historyEntry, /history\.replaceState\(null, '', '\/#weekly'\)/);
  assert.match(historyEntry, /window\.__ensureHistoryModeRuntime = ensureHistoryModeRuntime/);
  assert.match(historyEntry, /history-lite\.js\?v=20261001\.1/);
  assert.doesNotMatch(historyEntry, /history-page-fixes|history-table-cleanup|history-summary-average-labels|pages-ui-tweaks|pages-terminology/);
  assert.match(historyClient, /const MODES = Object\.freeze/);
  for (const mode of INTERNAL_ARCHIVE_MODES) assert.match(historyClient, new RegExp(`${mode}: \\{`));
});

test('Buddies tabs use the shared five-column navigation instead of history-owned tab CSS', () => {
  assert.match(navigationStyles, /\.stationhead-subtabs\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/s);
  assert.doesNotMatch(historyStyles, /\.mode-tabs\s*\{/);
});

test('history keeps the guide as an accessible hidden label source without styling the hidden guide', () => {
  assert.match(historyShell, /<div id="guide" hidden aria-hidden="true">/);
  assert.match(historyClient, /setText\('guideTitle', config\.title\)/);
  assert.match(historyClient, /setText\('tableTitle', config\.table\)/);
  assert.doesNotMatch(historyStyles, /\.guide\s*\{/);
});

test('history keeps one visible chart and delegates archive chart drawing to mode-specific runtimes', () => {
  assert.match(historyShell, /<canvas id="chart"[^>]*><\/canvas>/);
  assert.match(historyStyles, /\.data-panel \{[^}]*content-visibility:\s*auto/);
  assert.doesNotMatch(historyStyles, /\.chart-panel\s*\{|\.section-head\s*\{|\.chart-head\s*\{/);
  assert.doesNotMatch(historyClient, /drawSummaryChart|prepareCanvas|history-broadcasts\.js/);
  assert.match(historyClient, /history:data-loaded/);
  assert.match(historyEntry, /history-period-chart\.js\?v=\d{8}\.\d+/);
  assert.doesNotMatch(historyEntry, /history-ranking-chart/);
  assert.match(historyEntry, /history-broadcasts\.js\?v=20261001\.1/);
  assert.match(periodChart, /history:data-loaded/);
  assert.match(broadcastClient, /function draw\(\)/);
});

test('active history timestamps and range defaults are explicitly UTC', () => {
  assert.match(historyClient,/timeZone: 'UTC'/); assert.match(historyClient,/toISOString/); assert.match(likesClient,/jstDateTime/); assert.doesNotMatch(historyClient,/history-likes/);
});

test('track-specific archive aggregation and runtime are removed', () => {
  assert.doesNotMatch(historyData, /normalizeTrackRows|summarizeCompleteTrackRows|\/api\/track-history/);
  assert.doesNotMatch(historyEntry, /trackDate|trackWeekMode|'tracks'/);
  assert.doesNotMatch(historyClient, /TRACK_COLUMNS|trackDate|trackWeekMode|mode === 'tracks'|\/api\/track-history|aggregateCompleteTrackRows|history:track-rows/);
});

test('history inherits dashboard theme and shared card layout instead of duplicating them', () => {
  for (const declaration of [
    '--bg: #ffffff', '--panel: #ffffff', '--panel-2: #f4f4f4', '--line: #ddd', '--text: #111',
    '--muted: #666', '--accent: #d93f79', '--comment: #168b73', '--radius: 0',
  ]) {
    const pattern = new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.match(mainStyles, pattern);
    assert.doesNotMatch(historyStyles, pattern);
  }
  assert.doesNotMatch(historyStyles, /(^|\n):root\s*\{|(^|\n)\.button\s*\{|\.notice\s*\{|\.chart-panel\s*\{/m);
  assert.match(sharedLayout, /\.dashboard-view\s*>\s*:is\([^)]*\.chart-panel[^)]*\.data-panel/);
  assert.match(sharedLayout, /padding:\s*var\(--pages-panel-padding\)/);
});

test('history client uses only the canonical summary endpoints', () => {
  for (const mode of ['daily','weekly','monthly','broadcasts']) assert.match(historyClient,new RegExp(mode)); assert.match(historyClient,/\/api\/history/); assert.doesNotMatch(historyClient,/weekly_metrics|mode === 'ranking'/);
});

test('history client reduces repeated reads with mode-specific browser session caching', () => {
  assert.match(historyClient, /storage\.getItem/);
  assert.match(historyClient, /storage\.setItem/);
  assert.match(historyClient, /historyCacheTtl\(mode\)/);
  assert.match(historyData, /DAILY_HISTORY_CACHE_TTL_MS = 30_000/);
  assert.match(historyData, /DEFAULT_HISTORY_CACHE_TTL_MS = 60_000/);
});

test('history tables render newest rows first and paginate only in the browser', () => {
  assert.match(historyClient, /return \[\.\.\.rows\]\.reverse\(\)/);
  assert.match(historyClient, /const PAGE_SIZE = 200/);
  assert.match(historyClient, /state\.visibleRows \+= PAGE_SIZE/);
  assert.match(historyClient, /function exportCsv/);
});

test('integrated likes view reads materialized current ranking without playback counts', () => {
  for (const name of ['likes-ranking','likes-tbody','likes-csv']) assert.match(likesShell,new RegExp(name)); assert.match(browserSource('stationhead-channel-read-model.js'),/ranking_only=1/); assert.match(likesClient,/renderLikes/); assert.match(likesClient,/exportLikesCsv/); assert.doesNotMatch(likesClient,/play_count|weekly_plays/);
});

test('Sakurazaka endpoint and comparison client share one canonical name and direct revisions', () => {
  assert.match(sakurazakaApi, /subject: 'sakurazaka46jp'/);
  assert.match(sakurazakaApi, /cachedSakurazakaSeries/);
  assert.match(broadcastClient, /sakurazaka46jp:v1:/);
  assert.match(broadcastClient, /CACHE_REVISION = '9'/);
  assert.match(broadcastClient, /API_REVISION = '3'/);
  assert.match(broadcastClient, /\/api\/sakurazaka46jp\?/);
});

test('edge middleware materializes summaries while feature views stay lazy', () => {
  assert.match(middleware, /MATERIALIZED_API_VARIANTS/);
  assert.match(middleware, /SERVICE_MATERIALIZED_MODEL_KEYS/);
  assert.match(middleware, /headers\.set\('x-edge-cache', 'HTTP'\)/);
  assert.doesNotMatch(middleware, /caches\.default|cache\.put/);
  assert.match(middleware, /materializedApiKey/);
  assert.doesNotMatch(mainPage, /id="historyView"|id="likesView"|id="leaderboardView"|id="followersView"/);
});
