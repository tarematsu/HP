import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tabsClient = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');

const historyPageUrl = new URL('../public/history/index.html', import.meta.url);
const likesPageUrl = new URL('../public/history/likes/index.html', import.meta.url);

test('dashboard starts on current and exposes every mode in one tab panel', () => {
  assert.ok(page.indexOf('data-view="current"') < page.indexOf('data-mode="daily"'));
  assert.match(page, /data-view="current" class="active" aria-current="page">現在/);
  assert.match(page, /id="currentView" class="dashboard-view"/);
  assert.match(page, /id="historyView" class="dashboard-view history-view" hidden/);
  assert.match(page, /id="likesView" class="dashboard-view likes-view" hidden/);
  for (const mode of ['daily', 'weekly', 'monthly', 'ranking', 'likes', 'broadcasts']) {
    assert.match(page, new RegExp(`data-mode="${mode}"`));
  }
  assert.doesNotMatch(page, /data-mode="tracks"|id="trackControls"/);
});

test('archive and likes markup are integrated below the shared tab panel', () => {
  for (const id of ['controls', 'summaryCards', 'chartPanel', 'rankingWeeklyPanel']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  for (const id of ['likesLoad', 'likesCsv', 'likesNotice', 'likesRankingList', 'likesTbody']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.match(dashboardEntry, /import '\.\/dashboard-tabs\.js\?v=20260731\.1'/);
  assert.match(tabsClient, /import\('\/history\/history-main\.js'\)/);
  assert.match(tabsClient, /import\('\/history\/history-likes\.js'\)/);
  assert.match(tabsClient, /showOnly\(historyView\)/);
  assert.match(tabsClient, /showOnly\(likesView\)/);
  assert.match(historyEntry, /VALID_MODES/);
});

test('history and likes startup release unintended skip-link focus', () => {
  assert.match(tabsClient, /const skipLink = document\.querySelector\('\.skip-link'\)/);
  assert.match(tabsClient, /function releaseUnexpectedSkipLinkFocus\(\)/);
  assert.match(tabsClient, /document\.activeElement === skipLink[\s\S]*skipLink\?\.blur\(\)/);
  assert.match(tabsClient, /classList\.remove\('keyboard-navigation'\)/);
  assert.match(tabsClient, /showHistory[\s\S]*finally \{[\s\S]*releaseUnexpectedSkipLinkFocus\(\)/);
  assert.match(tabsClient, /showLikes[\s\S]*finally \{[\s\S]*releaseUnexpectedSkipLinkFocus\(\)/);
});

test('tab selection stays on the root document and never navigates to history pages', () => {
  assert.match(tabsClient, /mode === 'current' \? '\/' : `\/#\$\{mode\}`/);
  assert.match(tabsClient, /event\.preventDefault\(\)/);
  assert.doesNotMatch(page, /href="\/history/);
  assert.doesNotMatch(tabsClient, /location\.(?:assign|replace)\([^)]*history/);
  assert.doesNotMatch(historyEntry, /legacyHistoryRoute|location\.replace/);
});

test('current and history chart details remain isolated', () => {
  assert.match(page, /id="currentChartDetail"[^>]*data-current-chart-detail/);
  assert.match(page, /id="chartDetail"[^>]*data-history-chart-detail/);
  assert.equal((page.match(/id="chartDetail"/g) || []).length, 1);
  assert.match(tabsClient, /savedHistoryDetail/);
  assert.match(tabsClient, /currentChartDetail\.textContent/);
});

test('standalone history and likes HTML pages are removed', () => {
  assert.equal(existsSync(historyPageUrl), false);
  assert.equal(existsSync(likesPageUrl), false);
  assert.doesNotMatch(redirects, /^\/history/m);
});
