import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const historyShell = readFileSync(new URL('../public/history-shell.js', import.meta.url), 'utf8');
const likesShell = readFileSync(new URL('../public/likes-shell.js', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tabOrder = readFileSync(new URL('../public/dashboard-tab-order.js', import.meta.url), 'utf8');
const currentChartDetail = readFileSync(new URL('../public/dashboard-chart-detail.js', import.meta.url), 'utf8');
const tabsClient = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');

const historyPageUrl = new URL('../public/history/index.html', import.meta.url);
const likesPageUrl = new URL('../public/history/likes/index.html', import.meta.url);

test('dashboard starts on current and exposes every visible mode through the shared registry and shells', () => {
  assert.ok(registry.indexOf("view: 'current'") < registry.indexOf("mode: 'daily'"));
  assert.match(registry, /view: 'current', label: '現在', active: true/);
  assert.match(currentShell, /id: 'currentView'/);
  assert.match(currentShell, /hidden: false/);
  assert.match(historyShell, /id: 'historyView'/);
  assert.match(historyShell, /className: 'history-view'/);
  assert.match(likesShell, /id: 'likesView'/);
  assert.match(likesShell, /className: 'likes-view'/);
  for (const mode of ['daily', 'ranking', 'likes', 'broadcasts']) assert.match(registry, new RegExp(`mode: '${mode}'`));
  for (const view of ['played-tracks', 'spotify']) assert.match(registry, new RegExp(`view: '${view}'`));
  assert.doesNotMatch(registry, /view: 'first-week'|label: '初週比較'/);
  assert.doesNotMatch(registry, /mode: 'weekly'|mode: 'monthly'/);
  assert.doesNotMatch([registry, historyShell].join('\n'), /mode: 'tracks'|id="trackControls"/);
  assert.match(page, /<nav class="dashboard-navigation" aria-label="統計メニュー">/);
  for (const id of ['sectionTabs', 'sourceTabs', 'modeTabs']) assert.match(page, new RegExp(`id="${id}"`));
  assert.doesNotMatch(page, /id="currentView"|id="historyView"|id="likesView"/);
});

test('dashboard keeps Spotify at the right edge before routing starts', () => {
  assert.match(dashboardEntry, /dashboard-tab-order\.js\?v=20261002\.1/);
  assert.match(dashboardEntry, /dashboard-tabs\.js\?v=20260930\.1/);
  assert.ok(dashboardEntry.indexOf('dashboard-tab-order.js') < dashboardEntry.indexOf('dashboard-tabs.js'));
  assert.doesNotMatch(tabOrder, /firstWeek|first-week/);
  assert.match(tabOrder, /tabs\.append\(spotify\)/);
});

test('dashboard hides the static page skeleton until the selected route shell is ready', () => {
  assert.match(page, /<style id="dashboard-prepaint-guard">[\s\S]*html\[data-dashboard-booting\] #content \{ visibility: hidden; \}/);
  assert.match(page, /document\.documentElement\.setAttribute\('data-dashboard-booting', ''\)/);
  assert.match(page, /dashboard:route-ready/);
  assert.match(tabsClient, /window\.dispatchEvent\(new Event\('dashboard:route-ready'\)\)/);
  assert.ok(page.indexOf('dashboard-prepaint-guard') < page.indexOf('/assets/dashboard.min.css'));
});

test('archive and likes markup are owned by their shared shell modules', () => {
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
  assert.match(dashboardEntry, /import '\.\/dashboard-tabs\.js\?v=20260930\.1'/);
  assert.match(tabsClient, /import\('\/history\/history-main\.js\?v=\d{8}\.\d+'\)/);
  assert.match(tabsClient, /import\('\/history\/history-likes\.js\?v=20260930\.1'\)/);
  assert.match(tabsClient, /setRoute\(mode, runtimeReady \? historyView : null/);
  assert.match(tabsClient, /viewId: 'likesView'/);
  assert.match(historyEntry, /VALID_MODES/);
});

test('feature tabs share one lazy route registry and loader', () => {
  assert.match(tabsClient, /const LAZY_VIEWS = Object\.freeze/);
  assert.match(tabsClient, /const modulePromises = new Map\(\)/);
  assert.match(tabsClient, /function loadOnce\(key, importer\)/);
  assert.match(tabsClient, /async function showLazyView\(mode, options = \{}\)/);
  for (const [mode, shell, runtime] of [
    ['played-tracks', 'played-tracks-shell.js', 'played-tracks.js'],
    ['spotify', 'spotify-shell.js', 'spotify.js'],
    ['amazon-music', 'amazon-music-shell.js', 'amazon-music.js'],
    ['apple-music', 'apple-music-shell.js', 'apple-music.js'],
  ]) {
    assert.match(tabsClient, new RegExp(`'${mode}'|${mode}:`));
    assert.match(tabsClient, new RegExp(shell.replaceAll('.', '\\.')));
    assert.match(tabsClient, new RegExp(runtime.replaceAll('.', '\\.')));
  }
  assert.doesNotMatch(tabsClient, /'first-week': \{|first-week-comparison-shell|first-week-comparison\.js/);
  assert.match(tabsClient, /mode === 'first-week'[\s\S]*#broadcasts/);
  assert.doesNotMatch(tabsClient, /function ensureSpotifyShell|function showSpotify|function showAppleMusic|function showPlayedTracks/);
});

test('obsolete unofficial view is not a central dashboard route', () => {
  assert.doesNotMatch(tabsClient, /'unofficial'|unofficialView|showUnofficial/);
  assert.doesNotMatch(registry, /view: 'unofficial'/);
});

test('first-week comparison is loaded with the dashboard instead of behind a route loader', () => {
  assert.match(dashboardEntry, /import '\.\/first-week-comparison-shell\.js\?v=20261002\.2'/);
  assert.match(dashboardEntry, /import '\.\/first-week-comparison\.js\?v=20261002\.2'/);
  assert.doesNotMatch(historyEntry, /first-week-comparison-shell|first-week-comparison\.js/);
  assert.doesNotMatch(tabsClient, /first-week-comparison-shell|first-week-comparison\.js/);
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
  assert.match(tabsClient, /await ensureLazyShell\(mode\);\s*if \(activeMode !== mode\) return;/);
  assert.match(tabsClient, /const runtime = await loadOnce\(`\$\{mode\}:runtime`/);
  assert.match(tabsClient, /if \(activeMode !== mode\) return;\s*if \(config\.loadExport\)/);
  assert.match(tabsClient, /await loadOnce\('history-runtime'[\s\S]*if \(activeMode !== mode\) return;/);
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
