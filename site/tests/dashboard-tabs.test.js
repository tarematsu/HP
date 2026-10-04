import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const historyShell = readFileSync(new URL('../public/history-shell.js', import.meta.url), 'utf8');
const likesShell = readFileSync(new URL('../public/likes-shell.js', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const currentChartDetail = readFileSync(new URL('../public/dashboard-chart-detail.js', import.meta.url), 'utf8');
const tabsClient = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');

const historyPageUrl = new URL('../public/history/index.html', import.meta.url);
const likesPageUrl = new URL('../public/history/likes/index.html', import.meta.url);

test('dashboard starts on current and mounts only the five visible Buddies mode tabs', () => {
  assert.ok(registry.indexOf("view: 'current'") < registry.indexOf("mode: 'daily'"));
  assert.match(registry, /view: 'current', label: '現在', active: true/);
  assert.match(currentShell, /id: 'currentView'/);
  assert.match(currentShell, /hidden: false/);
  assert.match(historyShell, /id: 'historyView'/);
  assert.match(historyShell, /className: 'history-view'/);
  assert.match(likesShell, /id: 'likesView'/);
  assert.match(likesShell, /className: 'likes-view'/);
  for (const mode of ['daily', 'likes', 'broadcasts']) assert.match(registry, new RegExp(`mode: '${mode}'`));
  assert.match(registry, /view: 'played-tracks'/);
  assert.doesNotMatch(registry, /mode: 'ranking'|view: 'spotify'/);
  assert.match(tabsClient, /id: 'ranking', label: 'リーダーボード'/);
  assert.match(tabsClient, /id: 'spotify', label: 'Spotify'/);
  assert.doesNotMatch(registry, /view: 'first-week'|label: '初週比較'/);
  assert.doesNotMatch(registry, /mode: 'weekly'|mode: 'monthly'/);
  assert.doesNotMatch([registry, historyShell].join('\n'), /mode: 'tracks'|id="trackControls"/);
  assert.match(page, /<nav class="dashboard-navigation" aria-label="統計メニュー">/);
  for (const id of ['sectionTabs', 'sourceTabs', 'modeTabs']) assert.match(page, new RegExp(`id="${id}"`));
  assert.doesNotMatch(page, /id="currentView"|id="historyView"|id="likesView"/);
});

test('source-only routes live in the common navigation model instead of hidden mode buttons', () => {
  assert.doesNotMatch(registry, /mode: 'ranking'|view: 'spotify'/);
  assert.match(tabsClient, /id: 'ranking', label: 'リーダーボード', defaultMode: 'ranking'/);
  assert.match(tabsClient, /id: 'spotify', label: 'Spotify', defaultMode: 'spotify'/);
  assert.doesNotMatch(dashboardEntry, /dashboard-tab-order\.js/);
  assert.match(dashboardEntry, /dashboard-tabs\.js\?v=20261004\.1/);
});

test('dashboard hides the static page skeleton until the selected route shell is ready', () => {
  assert.match(page, /dashboard-prepaint-guard[\s\S]*html\[data-dashboard-booting\] #content\s*\{?\s*visibility:\s*hidden/);
  assert.match(page, /document\.documentElement\.setAttribute\('data-dashboard-booting',\s*''\)/);
  assert.match(page, /dashboard:route-ready/);
  assert.match(tabsClient, /window\.dispatchEvent\(new Event\('dashboard:route-ready'\)\)/);
  assert.ok(page.indexOf('dashboard-prepaint-guard') < page.indexOf('/assets/dashboard.min.css'));
});

test('archive and likes markup are owned by lazily loaded shared shell modules', () => {
  for (const id of ['controls', 'summaryCards', 'chartPanel', 'rankingWeeklyPanel']) {
    assert.match(historyShell, new RegExp(`(?:id=\\"${id}\\"|id: '${id}')`));
  }
  for (const id of ['likesCsv', 'likesNotice', 'likesRankingList', 'likesTbody']) {
    assert.match(likesShell, new RegExp(`(?:id=\\"${id}\\"|id: '${id}'|bodyId: '${id}')`));
  }
  assert.match(historyShell, /dashboardControls/);
  assert.match(historyShell, /dashboardSummary/);
  assert.match(historyShell, /dashboardChartCard/);
  assert.match(historyShell, /dashboardDataCard/);
  assert.match(likesShell, /dashboardSummary/);
  assert.match(likesShell, /dashboardDataCard/);
  assert.match(likesShell, /dashboardNotice/);
  assert.match(likesShell, /dashboardTable/);
  assert.doesNotMatch(likesShell, /id="likesLoad"/);
  assert.match(dashboardEntry, /import '\.\/dashboard-tabs\.js\?v=20261004\.1'/);
  assert.doesNotMatch(dashboardEntry, /history-shell|likes-shell/);
  assert.match(tabsClient, /shell: \(\) => import\('\/history-shell\.js\?v=20260930\.1'\)/);
  assert.match(tabsClient, /shell: \(\) => import\('\/likes-shell\.js\?v=20260930\.1'\)/);
  assert.match(tabsClient, /import\('\/history\/history-main\.js\?v=\d{8}\.\d+'\)/);
  assert.match(tabsClient, /import\('\/history\/history-likes\.js\?v=20260930\.1'\)/);
  assert.match(historyEntry, /VALID_MODES/);
});

test('feature tabs share one lazy route registry, stylesheet loader and module cache', () => {
  assert.match(tabsClient, /const LAZY_VIEWS = \{/);
  assert.match(tabsClient, /const modulePromises = new Map\(\)/);
  assert.match(tabsClient, /const stylePromises = new Map\(\)/);
  assert.match(tabsClient, /function ensureModeStyles\(mode\)/);
  assert.match(tabsClient, /async function showLazyView\(mode, options = \{}\)/);
  for (const [mode, shell, runtime] of [
    ['hinata', 'hinata-shell.js', 'hinata.js'],
    ['followers', 'followers-shell.js', 'followers.js'],
    ['played-tracks', 'played-tracks-shell.js', 'played-tracks.js'],
    ['likes', 'likes-shell.js', 'history-likes.js'],
    ['spotify', 'spotify-shell.js', 'spotify.js'],
    ['amazon-music', 'amazon-music-shell.js', 'amazon-music.js'],
    ['apple-music', 'apple-music-shell.js', 'apple-music.js'],
  ]) {
    assert.match(tabsClient, new RegExp(`'${mode}'|${mode}:`));
    assert.match(tabsClient, new RegExp(shell.replaceAll('.', '\\.')));
    assert.match(tabsClient, new RegExp(runtime.replaceAll('.', '\\.')));
  }
  assert.match(tabsClient, /stationhead\.min\.css/);
  assert.match(tabsClient, /subscriptions\.min\.css/);
  assert.doesNotMatch(tabsClient, /function ensureSpotifyShell|function showSpotify|function showAppleMusic|function showPlayedTracks/);
});

test('legacy listening-party hashes normalize to the shared broadcasts route only', () => {
  assert.match(tabsClient, /mode === 'first-week' \|\| mode === 'unofficial'/);
  assert.match(tabsClient, /#broadcasts/);
  assert.doesNotMatch(tabsClient, /unofficialView|showUnofficial|['"]unofficial['"]\s*:/);
  assert.doesNotMatch(registry, /view: 'unofficial'/);
});

test('first-week comparison loads only with the broadcasts route', () => {
  assert.doesNotMatch(dashboardEntry, /first-week-comparison-shell|first-week-comparison\.js/);
  assert.match(tabsClient, /mode === 'broadcasts'/);
  assert.match(tabsClient, /loadOnce\('first-week:shell'[\s\S]*first-week-comparison-shell\.js/);
  assert.match(tabsClient, /loadOnce\('first-week:runtime'[\s\S]*first-week-comparison\.js/);
  assert.doesNotMatch(historyEntry, /first-week-comparison-shell|first-week-comparison\.js/);
});

test('history mode-specific runtimes remain lazy-loaded after history starts', () => {
  assert.match(historyEntry, /function ensureHistoryModeRuntime/);
  assert.match(historyEntry, /history-period-chart\.js\?v=\d{8}\.\d+/);
  assert.match(historyEntry, /history-ranking-chart\.js\?v=20260930\.\d+/);
  assert.doesNotMatch(historyEntry, /history-ranking-missing-gap/);
  assert.doesNotMatch(historyEntry, /history-ranking-all-host-table\.js/);
  assert.match(historyEntry, /history-ranking-simplified\.js\?v=20261002\.1/);
  assert.match(tabsClient, /history-ranking-table-status\.js\?v=20260923\.2/);
  assert.match(tabsClient, /mode === 'ranking'[\s\S]*loadOnce\('ranking-status'/);
  assert.match(historyEntry, /history-broadcasts\.js\?v=20261001\.1/);
  assert.doesNotMatch(tabsClient, /history-period-chart|history-ranking-chart|history-broadcasts/);
});

test('late async runtimes cannot reactivate a tab the user already left', () => {
  assert.match(tabsClient, /await Promise\.all\([\s\S]*loadOnce\(`\$\{mode\}:shell`[\s\S]*if \(activeMode !== mode\) return;/);
  assert.match(tabsClient, /const runtime = await loadOnce\(`\$\{mode\}:runtime`/);
  assert.match(tabsClient, /if \(activeMode !== mode\) return;\s*if \(config\.loadExport\)/);
  assert.match(tabsClient, /await loadOnce\('history:runtime'[\s\S]*if \(activeMode !== mode\) return;/);
  assert.match(tabsClient, /catch \(error\) \{\s*if \(activeMode !== mode\) return;/);
});

test('route startup always releases unintended skip-link focus', () => {
  assert.match(tabsClient, /const skipLink = document\.querySelector\('\.skip-link'\)/);
  assert.match(tabsClient, /function releaseUnexpectedSkipLinkFocus\(\)/);
  assert.match(tabsClient, /document\.activeElement === skipLink[\s\S]*skipLink\?\.blur\(\)/);
  assert.match(tabsClient, /classList\.remove\('keyboard-navigation'\)/);
  assert.match(tabsClient, /showLazyView[\s\S]*finally \{[\s\S]*releaseUnexpectedSkipLinkFocus\(\)/);
  assert.match(tabsClient, /showHistory[\s\S]*finally \{[\s\S]*releaseUnexpectedSkipLinkFocus\(\)/);
});

test('tab selection stays on the root document and never navigates to history pages', () => {
  assert.match(tabsClient, /mode === 'current' \? '\/' : `\/#\$\{mode\}`/);
  assert.match(tabsClient, /event\.preventDefault\(\)/);
  assert.doesNotMatch(page, /href="\/history/);
  assert.doesNotMatch(tabsClient, /location\.(?:assign|replace)\([^)]*history/);
  assert.doesNotMatch(historyEntry, /legacyHistoryRoute|location\.replace/);
});

test('current and history chart details are owned by their respective shells and renderers', () => {
  assert.match(currentShell, /id="currentChartDetail"[^>]*data-current-chart-detail/);
  assert.match(historyShell, /id="chartDetail"[^>]*data-history-chart-detail/);
  assert.equal((historyShell.match(/id="chartDetail"/g) || []).length, 1);
  assert.match(dashboardEntry, /dashboard-chart-detail\.js\?v=20260930\.2/);
  assert.match(currentChartDetail, /document\.getElementById\('currentChartDetail'\)/);
  assert.doesNotMatch(tabsClient, /savedHistoryDetail|historyChartDetail|currentChartDetail\.textContent/);
});

test('standalone history and likes HTML pages are removed', () => {
  assert.equal(existsSync(historyPageUrl), false);
  assert.equal(existsSync(likesPageUrl), false);
  assert.doesNotMatch(redirects, /^\/history/m);
});
