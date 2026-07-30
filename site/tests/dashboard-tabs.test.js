import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const likesPage = readFileSync(new URL('../public/history/likes/index.html', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const tabsClient = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');

test('dashboard starts on current and exposes archive modes in the header', () => {
  assert.ok(page.indexOf('data-view="current"') < page.indexOf('data-mode="daily"'));
  assert.match(page, /data-view="current" class="active" aria-current="page">現在/);
  assert.match(page, /id="currentView" class="dashboard-view"/);
  assert.match(page, /id="historyView" class="dashboard-view history-view" hidden/);
  for (const mode of ['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']) {
    assert.match(page, new RegExp(`data-mode="${mode}"`));
  }
  assert.doesNotMatch(page, /data-mode="tracks"|id="trackControls"/);
});

test('archive markup is integrated and loaded lazily', () => {
  assert.match(page, /id="controls"/);
  assert.match(page, /id="summaryCards"/);
  assert.match(page, /id="chartPanel"/);
  assert.match(page, /id="rankingWeeklyPanel"/);
  assert.match(dashboardEntry, /import '\.\/dashboard-tabs\.js'/);
  assert.match(tabsClient, /import\('\/history\/history-main\.js'\)/);
  assert.match(tabsClient, /HISTORY_MODES/);
  assert.match(historyEntry, /VALID_MODES/);
  assert.doesNotMatch(historyEntry, /tracks|utcDate/);
});

test('tab navigation supports browser traversal', () => {
  assert.match(tabsClient, /pushState/);
  assert.match(tabsClient, /replaceState/);
  assert.match(tabsClient, /addEventListener\('popstate', syncFromLocation\)/);
  assert.match(tabsClient, /addEventListener\('hashchange', syncFromLocation\)/);
});

test('current and history chart details remain isolated', () => {
  assert.match(page, /id="currentChartDetail"[^>]*data-current-chart-detail/);
  assert.match(page, /id="chartDetail"[^>]*data-history-chart-detail/);
  assert.equal((page.match(/id="chartDetail"/g) || []).length, 1);
  assert.match(tabsClient, /savedHistoryDetail/);
  assert.match(tabsClient, /currentChartDetail\.textContent/);
  assert.doesNotMatch(tabsClient, /swapChartDetail/);
});

test('legacy history route redirects to the matching dashboard tab', () => {
  assert.match(historyEntry, /legacyHistoryRoute/);
  assert.match(historyEntry, /location\.replace/);
  assert.match(redirects, /^\/history\/\s+\/\s+301$/m);
});

test('likes navigation points directly to integrated dashboard tabs', () => {
  for (const mode of ['daily', 'weekly', 'monthly', 'ranking', 'broadcasts']) {
    assert.match(likesPage, new RegExp(`href="/#${mode}"`));
  }
  assert.doesNotMatch(likesPage, /\/history\/#|#tracks|weekPlays|今週再生/);
});
