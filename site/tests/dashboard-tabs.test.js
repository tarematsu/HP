import { browserSource } from './helpers/dashboard-source.js';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { HISTORY_MODES, ROUTES } from '../public/dashboard-navigation-config.js';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const registry = browserSource('dashboard-metrics.js');
const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const stationheadRuntime = browserSource('stationhead-channel.js');
const historyShell = readFileSync(new URL('../public/history-shell.js', import.meta.url), 'utf8');
const likesShell = browserSource('stationhead-channel-shell.js');
const leaderboardShell = readFileSync(new URL('../public/leaderboard-shell.js', import.meta.url), 'utf8');
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tabsClient = dashboardRouterSource();
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');

const historyPageUrl = new URL('../public/history/index.html', import.meta.url);
const likesPageUrl = new URL('../public/history/likes/index.html', import.meta.url);

test('dashboard starts on the shared Buddies Stationhead view without duplicate outer subtabs', () => {
  assert.match(currentShell, /mountStationheadChannelShell/);
  assert.match(currentShell, /id: 'currentView'/);
  assert.match(currentShell, /hidden: false/);
  assert.match(currentShell, /stationheadModel = 'buddies'/);
  assert.doesNotMatch(registry, /dashboard-tab-registry|modeTabs/);
  assert.doesNotMatch(registry, /querySelector.*modeTabs/);
  assert.doesNotMatch(registry, /STATIONHEAD_CHANNEL_TABS|BUDDIES_ROUTES|createElement\('button'\)/);
  assert.match(stationheadShell, /dashboardModeTabs/);
  assert.match(stationheadShell, /className: 'stationhead-subtabs'/);
  for (const section of ['current', 'history', 'played-tracks', 'likes', 'broadcasts']) {
    assert.match(stationheadShell, new RegExp(`data-stationhead-panel=\\"${section}\\"`));
  }
  assert.match(tabsClient, /id: 'buddies', label: 'Buddies', defaultMode: 'current'/);
  assert.match(tabsClient, /mode: 'ranking', label: 'リーダーボード'/);
  assert.match(tabsClient, /id: 'spotify', label: 'Spotify'/);
  assert.match(page, /<nav class="dashboard-navigation" aria-label="統計メニュー">/);
  for (const id of ['sectionTabs', 'sourceTabs', 'functionTabs']) assert.match(page, new RegExp(`id="${id}"`));
  assert.doesNotMatch(page, /id="currentView"|id="historyView"|id="likesView"/);
});

test('leaderboard and followers are Buddies functions with shared views', () => {
  assert.doesNotMatch(registry, /mode: 'ranking'|view: 'spotify'/);
  assert.equal(ROUTES.ranking.viewId, 'leaderboardView');
  assert.deepEqual(ROUTES.ranking.loadArgs, { source: 'stationhead' });
  assert.equal(ROUTES.followers.viewId, 'followersView');
  assert.deepEqual(ROUTES.followers.loadArgs, { source: 'stationhead' });
  assert.doesNotMatch(tabsClient, /music-ranking|music-followers|source: 'music-streaming'/);
  assert.match(leaderboardShell, /id: 'leaderboardView'/);
  assert.match(followersShell, /id: 'followersView'/);
});

test('dashboard hides the static page skeleton until the selected route shell is ready', () => {
  assert.match(page, /dashboard-prepaint-guard[\s\S]*html\[data-dashboard-booting\] #content\s*\{?\s*visibility:\s*hidden/);
  assert.match(page, /document\.documentElement\.setAttribute\('data-dashboard-booting',\s*''\)/);
  assert.match(page, /dashboard:route-ready/);
  assert.match(tabsClient, /window\.dispatchEvent\(new Event\('dashboard:route-ready'\)\)/);
});

test('archive and likes markup are owned by lazily loaded shared shell modules', () => {
  assert.match(historyShell, /historyView/); for (const role of ['likes-csv','likes-ranking','likes-tbody']) assert.match(likesShell, new RegExp(role)); assert.match(tabsClient, /selectStationheadChannelSection/); assert.doesNotMatch(dashboardEntry, /likes-shell/);
});

test('feature tabs share one lazy route registry stylesheet loader and module cache', () => {
  assert.match(tabsClient, /const DASHBOARD_ROUTE_MODULES = Object\.freeze\(\{/);
  assert.match(tabsClient, /const modulePromises = new Map\(\)/);
  assert.match(readFileSync(new URL('../public/dashboard-styles.js', import.meta.url), 'utf8'), /const stylePromises = new Map\(\)/);
  assert.match(tabsClient, /function ensureModeStyles\(mode\)/);
  assert.match(tabsClient, /async function showLazyView\(mode, route, options = \{\}\)/);
  for (const mode of ['hinata', 'ranking', 'followers', 'spotify', 'amazon-music', 'apple-music']) {
    assert.equal(ROUTES[mode].kind, 'lazy');
    assert.equal(ROUTES[mode].moduleId, mode);
  }
  assert.match(tabsClient, /route\.loadExport\) await runtime\[route\.loadExport\]\?\.\(route\.loadArgs \|\| undefined\)/);
  assert.match(tabsClient, /ensureDashboardSectionStyles/);
});

test('legacy listening-party hashes normalize to the shared broadcasts route only', () => {
  assert.match(tabsClient, /mode === 'first-week' \|\| mode === 'unofficial'/);
  assert.match(tabsClient, /#broadcasts/);
  assert.doesNotMatch(tabsClient, /unofficialView|showUnofficial|['"]unofficial['"]\s*:/);
  assert.doesNotMatch(registry, /view: 'unofficial'/);
});

test('first-week comparison loads only with the broadcasts route', () => {
  assert.doesNotMatch(dashboardEntry, /first-week-comparison-shell|first-week-comparison\.js/);
  assert.equal(ROUTES.broadcasts.firstWeek, true);
  assert.match(tabsClient, /loadOnce\('first-week:shell'[\s\S]*first-week-comparison-shell\.js/);
  assert.match(tabsClient, /loadOnce\('first-week:runtime'[\s\S]*first-week-comparison\.js/);
  assert.doesNotMatch(historyEntry, /first-week-comparison-shell|first-week-comparison\.js/);
});

test('history no longer owns the leaderboard runtime', () => {
  assert.match(historyEntry, /const VALID_MODES = new Set\(\[\.\.\.SUMMARY_MODES, 'broadcasts'\]\)/);
  assert.doesNotMatch(historyEntry, /history-ranking-chart|history-ranking-simplified|mode === 'ranking'/);
  assert.doesNotMatch(tabsClient, /history-ranking-table-status/);
  assert.equal(HISTORY_MODES.has('ranking'), false);
  assert.equal(ROUTES.ranking.kind, 'lazy');
  assert.equal(ROUTES.ranking.moduleId, 'ranking');
  assert.match(historyEntry, /history-broadcasts\.js\?v=20261001\.1/);
});

test('late async runtimes cannot reactivate a tab the user already left', () => {
  assert.match(tabsClient, /await Promise\.all\([\s\S]*loadOnce\(`\$\{mode\}:shell`[\s\S]*if \(activeMode !== mode\) return;/);
  assert.match(tabsClient, /const runtime = await loadOnce\(`\$\{mode\}:runtime`/);
  assert.match(tabsClient, /if \(activeMode !== mode\) return;\s*if \(route\.loadExport\)/);
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
  assert.match(tabsClient, /button\.type = 'button'/);
  assert.doesNotMatch(page, /href="\/history/);
  assert.doesNotMatch(tabsClient, /location\.(?:assign|replace)\([^)]*history/);
  assert.doesNotMatch(historyEntry, /legacyHistoryRoute|location\.replace/);
});

test('current Stationhead detail and history detail stay in their owning shells', () => {
  assert.match(stationheadShell, /role\('live-detail'\)/);
  assert.match(historyShell, /id="chartDetail"[^>]*data-history-chart-detail/);
  assert.equal((historyShell.match(/id="chartDetail"/g) || []).length, 1);
  assert.match(tabsClient, /stationhead-channel\.js\?v=/);
  assert.match(stationheadRuntime, /setText\(root, 'live-detail'/);
});

test('standalone history and likes HTML pages are removed', () => {
  assert.equal(existsSync(historyPageUrl), false);
  assert.equal(existsSync(likesPageUrl), false);
  assert.doesNotMatch(redirects, /^\/history/m);
});
