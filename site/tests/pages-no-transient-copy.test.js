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
  assert.match(history, /broadcasts: \{ title: '公式リスパ比較', table: '公式リスパ一覧', chart: '公式リスパ 同接推移（開始0分比較）' \}/);
  assert.match(history, /querySelectorAll\('#modeTabs button'\)[\s\S]*classList\.toggle\('active'/);
  assert.match(tabs, /function renderFunctionTabs\(source, mode\) \{[\s\S]*button\.classList\.toggle\('active', selected\)/);
  assert.doesNotMatch(tabs, /function renderFunctionTabs\(source, mode\) \{\s*if \(HISTORY_MODES\.has\(mode\)\) return;/);
  assert.doesNotMatch(broadcasts, /button\.textContent = '公式リスパ'/);
  assert.doesNotMatch(broadcasts, /chartTitle'\)\.textContent|chartFoot'\)\.textContent/);
  assert.doesNotMatch(broadcastTable, /tableTitle\.textContent/);
  assert.doesNotMatch(periodChart, /chartTitle/);
  assert.match(periodChart, /foot\.textContent = hasMissingBand/);
  assert.match(periodChart, /灰色は欠測期間です。/);
  assert.doesNotMatch(history, /左軸は同接（平均・最大・最小）、右軸は各期間の再生数増加です。/);
});
