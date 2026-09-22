import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const tabsClient = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');

test('dashboard starts on current and exposes every mode in one tab panel', () => {
  assert.match(page, /data-view="current"[^>]*>現在</);
  for (const mode of ['daily', 'weekly', 'monthly', 'ranking', 'broadcasts', 'likes']) {
    assert.match(page, new RegExp(`data-mode="${mode}"`));
  }
  assert.match(tabsClient, /const initialMode = modeFromHash\(\) \|\| 'current'/);
});

test('archive and likes markup are integrated below the shared tab panel', () => {
  assert.match(page, /id="historyView"/);
  assert.match(page, /id="likesView"/);
  assert.doesNotMatch(page, /href="\/history/);
});

test('inactive history and likes runtimes are not prefetched from the current tab', () => {
  assert.doesNotMatch(tabsClient, /modulepreload|preloadModule|scheduleRuntimePrefetch|requestIdleCallback/);
  assert.doesNotMatch(page, /modulepreload[^>]*(?:history-main|history-likes)/);
});

test('history mode-specific runtimes are lazy-loaded only after history starts', () => {
  assert.match(historyEntry, /function ensureHistoryModeRuntime/);
  assert.match(historyEntry, /history-period-chart\.js\?v=20260923\.\d+/);
  assert.match(historyEntry, /history-ranking-chart\.js\?v=20260923\.5/);
  assert.match(historyEntry, /history-broadcasts\.js\?v=20260923\.\d+/);
  assert.doesNotMatch(tabsClient, /history-period-chart|history-ranking-chart|history-broadcasts/);
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
  assert.doesNotMatch(tabsClient, /location\.href\s*=\s*['"]\/history/);
});
