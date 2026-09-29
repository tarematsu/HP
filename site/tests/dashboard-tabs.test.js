import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tabOrder = readFileSync(new URL('../public/dashboard-tab-order.js', import.meta.url), 'utf8');
const currentChartDetail = readFileSync(new URL('../public/dashboard-chart-detail.js', import.meta.url), 'utf8');
const tabsClient = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');

const historyPageUrl = new URL('../public/history/index.html', import.meta.url);
const likesPageUrl = new URL('../public/history/likes/index.html', import.meta.url);

test('dashboard starts on current and exposes every visible mode in the static tab panel', () => {
  assert.ok(page.indexOf('data-view="current"') < page.indexOf('data-mode="daily"'));
  assert.match(page, /data-view="current" class="active" aria-current="page">現在/);
  assert.match(page, /id="currentView" class="dashboard-view"/);
  assert.match(page, /id="historyView" class="dashboard-view history-view" hidden/);
  assert.match(page, /id="likesView" class="dashboard-view likes-view" hidden/);
  for (const mode of ['daily', 'ranking', 'likes', 'broadcasts']) {
    assert.match(page, new RegExp(`data-mode="${mode}"`));
  }
  for (const view of ['first-week', 'played-tracks', 'spotify']) {
    assert.match(page, new RegExp(`data-view="${view}"`));
  }
  assert.doesNotMatch(page, /data-mode="weekly"|data-mode="monthly"/);
  assert.doesNotMatch(page, /data-mode="tracks"|id="trackControls"/);
});

test('dashboard reorders the right edge to first-week then Spotify before routing starts', () => {
  assert.match(dashboardEntry, /dashboard-tab-order\.js\?v=20260929\.1/);
  assert.match(dashboardEntry, /dashboard-tabs\.js\?v=20260930\.1/);
  assert.ok(dashboardEntry.indexOf('dashboard-tab-order.js') < dashboardEntry.indexOf('dashboard-tabs.js'));
  assert.match(tabOrder, /tabs\.append\(firstWeek\)/);
  assert.match(tabOrder, /tabs\.append\(spotify\)/);
  assert.ok(tabOrder.indexOf('append(firstWeek)') < tabOrder.indexOf('append(spotify)'));
});

test('dashboard hides the legacy static shell until the selected route shell is ready', () => {
  assert.match(page, /<style id="dashboard-prepaint-guard">[\s\S]*html\[data-dashboard-booting\] #content \{ visibility: hidden; \}/);
  assert.match(page, /document\.documentElement\.setAttribute\('data-dashboard-booting', ''\)/);
  assert.match(page, /dashboard:route-ready/);
  assert.match(tabsClient, /window\.dispatchEvent\(new Event\('dashboard:route-ready'\)\)/);
  assert.ok(page.indexOf('dashboard-prepaint-guard') < page.indexOf('app-lite.css'));
});

test('archive and likes markup are integrated below the shared tab panel', () => {
  for (const id of ['controls', 'summaryCards', 'chartPanel', 'rankingWeeklyPanel']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  for (const id of ['likesCsv', 'likesNotice', 'likesRankingList', 'likesTbody']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(page, /id="likesLoad"/);
  assert.match(dashboardEntry, /import '\.\/dashboard-tabs\.js\?v=20260930\.1'/);
  assert.match(tabsClient, /import\('\/history\/history-main\.js\?v=20260928\.1'\)/);
  assert.match(tabsClient, /import\('\/history\/history-likes\.js\?v=20260925\.1'\)/);
  assert.match(tabsClient, /showOnly\(historyView\)/);
  assert.match(tabsClient, /showOnly\(likesView\)/);
  assert.match(historyEntry, /VALID_MODES/);
});

test('first-week comparison shell and runtime are both lazy routes', () => {
  assert.doesNotMatch(dashboardEntry, /^import .*first-week-comparison-shell/m);
  assert.match(tabsClient, /import\('\/first-week-comparison-shell\.js\?v=20260929\.1'\)/);
  assert.match(tabsClient, /'first-week'/);
  assert.match(tabsClient, /document\.getElementById\('firstWeekView'\)/);
  assert.match(tabsClient, /import\('\/first-week-comparison\.js\?v=20260929\.1'\)/);
  assert.match(tabsClient, /showFirstWeek/);
});

test('Spotify shell and runtime are owned by the central lazy router', () => {
  assert.doesNotMatch(dashboardEntry, /^import .*spotify-shell/m);
  assert.match(tabsClient, /import\('\/spotify-shell\.js\?v=20260929\.1'\)/);
  assert.doesNotMatch(dashboardEntry, /spotify-tab-router/);
  assert.match(tabsClient, /VIEW_MODES[\s\S]*'spotify'/);
  assert.match(tabsClient, /document\.getElementById\('spotifyView'\)/);
  assert.match(tabsClient, /import\('\/spotify\.js\?v=20260929\.1'\)/);
  assert.match(tabsClient, /showSpotify/);
  assert.match(tabsClient, /else if \(mode === 'spotify'\) void showSpotify/);
  assert.match(tabsClient, /button\.dataset\.view === 'spotify'/);
});

test('Apple Music shell and runtime are owned by the central lazy router', () => {
  assert.doesNotMatch(dashboardEntry, /^import .*apple-music-shell/m);
  assert.match(tabsClient, /import\('\/apple-music-shell\.js\?v=20260930\.1'\)/);
  assert.match(tabsClient, /VIEW_MODES[\s\S]*'apple-music'/);
  assert.match(tabsClient, /appleMusicView/);
  assert.match(tabsClient, /import\('\/apple-music\.js\?v=20260930\.1'\)/);
  assert.match(tabsClient, /showAppleMusic/);
  assert.match(tabsClient, /else if \(mode === 'apple-music'\) void showAppleMusic/);
  assert.match(tabsClient, /button\.dataset\.view === 'apple-music'/);
});

test('obsolete unofficial view is not a central dashboard route', () => {
  assert.doesNotMatch(tabsClient, /'unofficial'|unofficialView|showUnofficial/);
  assert.doesNotMatch(page, /data-view="unofficial"|id="unofficialView"/);
});

test('inactive route runtimes are not prefetched from the current tab', () => {
  assert.doesNotMatch(tabsClient, /modulepreload|preloadModule|scheduleRuntimePrefetch|requestIdleCallback/);
  assert.doesNotMatch(page, /modulepreload[^>]*(?:history-main|history-likes|spotify|played-tracks|first-week)/);
});

test('history mode-specific runtimes are lazy-loaded only after history starts', () => {
  assert.match(historyEntry, /function ensureHistoryModeRuntime/);
  assert.match(historyEntry, /history-period-chart\.js\?v=20260923\.\d+/);
  assert.match(historyEntry, /history-ranking-chart\.js\?v=20260930\.1/);
  assert.doesNotMatch(historyEntry, /history-ranking-missing-gap/);
  assert.match(historyEntry, /history-ranking-all-host-table\.js\?v=20260930\.1/);
  assert.match(tabsClient, /history-ranking-table-status\.js\?v=20260923\.2/);
  assert.match(tabsClient, /if \(mode === 'ranking'\)[\s\S]*await loadRankingStatusRuntime\(\);[\s\S]*if \(activeMode !== mode\) return;/);
  assert.match(historyEntry, /history-broadcasts\.js\?v=20260927\.1/);
  assert.doesNotMatch(tabsClient, /history-period-chart|history-ranking-chart|history-broadcasts/);
});

test('late async history runtimes cannot reactivate a tab the user already left', () => {
  assert.match(tabsClient, /await loadHistoryRuntime\(\);\s*if \(activeMode !== mode\) return;/);
  assert.match(tabsClient, /if \(mode === 'ranking'\) \{[\s\S]*await loadRankingStatusRuntime\(\);[\s\S]*if \(activeMode !== mode\) return;/);
  assert.match(tabsClient, /catch \(error\) \{\s*if \(activeMode !== mode\) return;/);
  assert.match(tabsClient, /showLikes[\s\S]*catch \(error\) \{\s*if \(activeMode !== 'likes'\) return;/);
  assert.match(tabsClient, /showSpotify[\s\S]*if \(activeMode !== 'spotify'\) return;/);
  assert.match(tabsClient, /showAppleMusic[\s\S]*if \(activeMode !== 'apple-music'\) return;/);
});

test('history and likes startup release unintended skip-link focus', () => {
  assert.match(tabsClient, /const skipLink = document\.querySelector\('\.skip-link'\)/);
  assert.match(tabsClient, /function releaseUnexpectedSkipLinkFocus\(\)/);
  assert.match(tabsClient, /document\.activeElement === skipLink[\s\S]*skipLink\?\.blur\(\)/);
  assert.match(tabsClient, /classList\.remove\('keyboard-navigation'\)/);
  assert.match(tabsClient, /showHistory[\s\S]*finally \{[\s\S]*releaseUnexpectedSkipLinkFocus\(\)/);
  assert.match(tabsClient, /showLikes[\s\S]*finally \{[\s\S]*releaseUnexpectedSkipLinkFocus\(\)/);
  assert.match(tabsClient, /showSpotify[\s\S]*finally \{[\s\S]*releaseUnexpectedSkipLinkFocus\(\)/);
});

test('tab selection stays on the root document and never navigates to history pages', () => {
  assert.match(tabsClient, /mode === 'current' \? '\/' : `\/#\$\{mode\}`/);
  assert.match(tabsClient, /event\.preventDefault\(\)/);
  assert.doesNotMatch(page, /href="\/history/);
  assert.doesNotMatch(tabsClient, /location\.(?:assign|replace)\([^)]*history/);
  assert.doesNotMatch(historyEntry, /legacyHistoryRoute|location\.replace/);
});

test('current and history chart details are owned by their respective renderers', () => {
  assert.match(page, /id="currentChartDetail"[^>]*data-current-chart-detail/);
  assert.match(page, /id="chartDetail"[^>]*data-history-chart-detail/);
  assert.equal((page.match(/id="chartDetail"/g) || []).length, 1);
  assert.match(dashboardEntry, /dashboard-chart-detail\.js\?v=20260929\.1/);
  assert.match(currentChartDetail, /document\.getElementById\('currentChartDetail'\)/);
  assert.doesNotMatch(tabsClient, /savedHistoryDetail|historyChartDetail|currentChartDetail\.textContent/);
});

test('standalone history and likes HTML pages are removed', () => {
  assert.equal(existsSync(historyPageUrl), false);
  assert.equal(existsSync(likesPageUrl), false);
  assert.doesNotMatch(redirects, /^\/history/m);
});
