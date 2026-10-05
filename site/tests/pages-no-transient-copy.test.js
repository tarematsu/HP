import { browserSource } from './helpers/dashboard-source.js';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/index.html');
const header = read('../public/dashboard-header.js');
const tabs = dashboardRouterSource();
const shell = read('../public/history-shell.js');
const history = read('../public/history/history-lite.js');
const periodChart = read('../public/history/history-period-chart.js');
const broadcasts = read('../public/history/history-broadcasts.js');
const broadcastTable = read('../public/history/history-broadcast-table.js');

test('dashboard title is final in HTML and is not rewritten after paint', () => {
  assert.match(html, /<title>#櫻坂46_ステへ統計<\/title>/);
  assert.match(html, /<h1 id="channelName"><a[^>]*>#櫻坂46_ステへ統計<\/a><\/h1>/);
  assert.doesNotMatch(header, /document\.title|channelName\.replaceChildren|DASHBOARD_TITLE/);
});

test('history shell contains structure only and first reveal waits for shell, CSS and runtime initialization', () => {
  for (const copy of ['主要指標の推移', '集計一覧', '再生数増加', 'メンバー増加数']) {
    assert.doesNotMatch(shell, new RegExp(`>${copy}<`));
  }
  assert.match(tabs, /setRoute\(mode, null, \{ updateUrl, replaceUrl \}\)/);
  assert.match(tabs, /ensureModeStyles\(mode\)/);
  assert.match(tabs, /loadOnce\('history:shell', HISTORY_VIEW\.shell\)/);
  assert.match(tabs, /await loadOnce\('history:runtime',[\s\S]*showOnly\(document\.getElementById\(HISTORY_VIEW\.viewId\)\);[\s\S]*markRouteReady\(\)/);
});

test('history static copy stays in runtime and tabs update immediately', () => {
  assert.match(history,/const MODES = Object.freeze/); assert.doesNotMatch(history,/#modeTabs/); assert.match(browserSource('dashboard-tabs.js'),/renderFunctionTabs/);
});
