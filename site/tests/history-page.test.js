import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const mainPage = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyClient = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const historyFixes = readFileSync(new URL('../public/history/history-page-fixes.js', import.meta.url), 'utf8');
const historyGuard = readFileSync(new URL('../public/history/history-request-guard.js', import.meta.url), 'utf8');
const historyStyles = readFileSync(new URL('../public/history/history-lite.css', import.meta.url), 'utf8');
const mainStyles = readFileSync(new URL('../public/app-lite.css', import.meta.url), 'utf8');
const likesClient = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');
const broadcastClient = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
const trackHistoryApi = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');
const rankingLibrary = readFileSync(new URL('../functions/lib/track-ranking.js', import.meta.url), 'utf8');
const sakurazakaApi = readFileSync(new URL('../functions/api/sakurazaka46jp.js', import.meta.url), 'utf8');
const middleware = readFileSync(new URL('../functions/_middleware.js', import.meta.url), 'utf8');

const ARCHIVE_MODES = ['daily', 'weekly', 'monthly', 'ranking', 'broadcasts'];

 test('main dashboard exposes archive modes and likes without separate pages', () => {
  for (const mode of ARCHIVE_MODES) {
    assert.match(mainPage, new RegExp(`data-view="history" data-mode="${mode}"`));
  }
  assert.match(mainPage, /data-view="likes" data-mode="likes">いいね/);
  assert.doesNotMatch(mainPage, /data-mode="tracks"|>再生曲</);
  assert.equal(existsSync(new URL('../public/history/index.html', import.meta.url)), false);
  assert.equal(existsSync(new URL('../public/history/likes/index.html', import.meta.url)), false);
});

test('monthly tab appears before leaderboard in the shared panel', () => {
  assert.ok(mainPage.indexOf('data-mode="monthly"') < mainPage.indexOf('data-mode="ranking"'));
});

test('embedded history defaults invalid hashes to weekly', () => {
  assert.match(historyEntry, /const VALID_MODES = new Set\(\['daily', 'weekly', 'ranking', 'monthly', 'broadcasts'\]\)/);
  assert.doesNotMatch(historyEntry, /'tracks'/);
  assert.match(historyEntry, /history\.replaceState\(null, '', '\/#weekly'\)/);
  assert.match(historyEntry, /import\('\/history\/history-lite\.js'\)/);
  assert.match(historyClient, /const MODES = Object\.freeze/);
  for (const mode of ARCHIVE_MODES) assert.match(historyClient, new RegExp(`${mode}: \\{`));
});

test('shared tabs use a fixed grid without horizontal scrolling', () => {
  assert.match(historyStyles, /\.mode-tabs \{[^}]*display:\s*grid/);
  assert.match(historyStyles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(historyStyles, /\.mode-tabs \{[^}]*overflow:\s*hidden/);
  assert.match(historyStyles, /\.mode-tabs button, \.mode-tabs a \{[^}]*white-space:\s*normal/);
});

test('history keeps the guide as an accessible hidden label source', () => {
  assert.match(mainPage, /<div id="guide" hidden aria-hidden="true">/);
  assert.match(historyClient, /setText\('guideTitle', config\.title\)/);
  assert.match(historyClient, /setText\('tableTitle', config\.table\)/);
});

test('history keeps one visible chart and delegates official series rendering', () => {
  assert.match(mainPage, /<canvas id="chart"[^>]*><\/canvas>/);
  assert.match(historyStyles, /\.chart-panel \{[^}]*margin-top/);
  assert.match(historyStyles, /\.data-panel \{[^}]*content-visibility:\s*auto/);
  assert.match(historyClient, /function drawSummaryChart/);
  assert.match(historyClient, /import\('\/history\/history-broadcasts\.js'\)/);
  assert.match(broadcastClient, /function draw\(\)/);
});

test('active history timestamps and range defaults are explicitly UTC', () => {
  assert.match(historyClient, /timeZone: 'UTC'/);
  assert.match(historyClient, /const todayUtc = \(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(historyClient, /\['started_at', '開始日時（UTC）'\]/);
  assert.match(historyFixes, /applyUtcPreset/);
  assert.match(likesClient, /timeZone: 'UTC'/);
  assert.doesNotMatch([historyEntry, historyClient, historyFixes, likesClient].join('\n'), /Asia\/Tokyo|JST_OFFSET_MS|jstDate|todayJst|currentJstWeekRange|applyJstPreset/);
});

test('track-specific archive aggregation and request hooks are removed', () => {
  assert.doesNotMatch(historyFixes, /aggregateCompleteTrackRows|history:track-rows|再生数ランキング/);
  assert.doesNotMatch(historyGuard, /normalizeTrackRows|summarizeCompleteTrackRows|\/api\/track-history/);
  assert.doesNotMatch(historyEntry, /trackDate|trackWeekMode/);
});

test('history visual tokens and panel sizing match the main dashboard', () => {
  for (const declaration of [
    '--bg: #f6f8fb',
    '--panel: #ffffff',
    '--panel-2: #f1f4f8',
    '--line: #d9e1eb',
    '--text: #172033',
    '--muted: #667287',
    '--accent: #d93f79',
    '--comment: #168b73',
    '--radius: 20px',
  ]) {
    const pattern = new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.match(mainStyles, pattern);
    assert.match(historyStyles, pattern);
  }
  assert.match(historyStyles, /\.button \{[^}]*min-height:\s*44px/);
  assert.match(historyStyles, /\.chart-panel \{[^}]*padding:\s*18px/);
  assert.match(historyStyles, /\.data-panel \{[^}]*padding:\s*18px/);
});

test('history client uses only the canonical summary endpoints', () => {
  assert.match(historyClient, /\/api\/history\?/);
  assert.doesNotMatch(mainPage, /\/api\/track-history/);
  assert.match(historyClient, /weekly_metrics/);
  assert.match(broadcastClient, /\/api\/sakurazaka46jp\?/);
});

test('history client reduces repeated reads with browser session caching', () => {
  assert.match(historyClient, /sessionStorage\.getItem/);
  assert.match(historyClient, /sessionStorage\.setItem/);
  assert.match(historyClient, /5 \* 60_000/);
});

test('history tables render newest rows first and paginate only in the browser', () => {
  assert.match(historyClient, /return \[\.\.\.rows\]\.reverse\(\)/);
  assert.match(historyClient, /const PAGE_SIZE = 200/);
  assert.match(historyClient, /state\.visibleRows \+= PAGE_SIZE/);
  assert.match(historyClient, /function exportCsv/);
});

test('integrated likes view reads current ranking directly without playback counts', () => {
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
  assert.match(trackHistoryApi, /loadTrackRanking/);
  assert.match(rankingLibrary, /FROM sh_track_ranking_current/);
  assert.doesNotMatch(rankingLibrary, /FROM sh_track_counter_current/);
});

test('Sakurazaka endpoint and comparison client share one canonical name', () => {
  assert.match(sakurazakaApi, /subject: 'sakurazaka46jp'/);
  assert.match(sakurazakaApi, /cachedSakurazakaSeries/);
  assert.match(broadcastClient, /sakurazaka46jp:v1:/);
  assert.match(broadcastClient, /\/api\/sakurazaka46jp\?/);
});

test('edge middleware materializes summaries but not track history', () => {
  assert.match(middleware, /MATERIALIZED_API_VARIANTS/);
  assert.match(middleware, /SERVICE_MATERIALIZED_MODEL_KEYS/);
  assert.match(middleware, /cache\.put/);
  assert.match(middleware, /materializedApiKey/);
});
