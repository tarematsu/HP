import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/hinata-shell.js', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/hinata.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/hinata.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/hinata.js', import.meta.url), 'utf8');

test('Pages mounts a dedicated Hinata dashboard tab after Amazon Music', () => {
  assert.match(metrics, /hinata-shell\.js/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /view: 'hinata'/);
  assert.match(shell, /label: 'Ohisama'/);
  assert.match(shell, /anchorSelectors: \['\[data-view="amazon-music"\]', '\[data-view="spotify"\]'\]/);
  assert.match(shell, /position: 'afterend'/);
  assert.match(shell, /日向坂/);
  assert.match(shell, /オンライン/);
  assert.match(shell, /総再生数/);
  assert.match(shell, /総メンバー数/);
  assert.match(shell, /日次データ/);
  assert.match(route, /hinata: \{/);
  assert.match(route, /viewId: 'hinataView'/);
  assert.match(sharedUi, /export function mountDashboardShell/);
  assert.match(sharedRoute, /function modeFromLocation\(\)/);
});

test('Ohisama composes the canonical metrics, chart and table cards without feature layout CSS', () => {
  for (const helper of ['dashboardMetric', 'dashboardMetrics', 'dashboardChartCard', 'dashboardLegend', 'dashboardTable', 'dashboardDataCard']) {
    assert.match(shell, new RegExp(helper));
    assert.match(sharedUi, new RegExp(`export function ${helper}\\(`));
  }
  assert.match(shell, /<canvas id="hinataChart" width="960" height="360"/);
  assert.match(shell, /<canvas id="hinataDailyChart" width="960" height="360"/);
  assert.match(shell, /class="chart-fit"/);
  assert.doesNotMatch(shell, /dashboardChartHost|shared-svg-chart|hinata-legend|hinata-chart-panel|hinata-daily-chart-panel/);
  assert.doesNotMatch(css, /font-size:|padding:|min-height:|\.hinata-chart|\.hinata-legend/);
});

test('Ohisama charts reuse the canonical dashboard Canvas foundation', () => {
  assert.match(runtime, /dashboard-chart-canvas\.js\?v=20261001\.2/);
  for (const helper of ['prepareDashboardCanvas', 'drawDashboardGrid', 'drawDashboardLine', 'drawDashboardXAxis', 'dashboardTickIndexes']) {
    assert.match(runtime, new RegExp(helper));
  }
  assert.doesNotMatch(runtime, /getContext\('2d'\)|window\.devicePixelRatio|context\.setTransform|canvas\.width = Math\.round/);
  assert.doesNotMatch(runtime, /svgElement|createElementNS|viewBox/);
});

test('Hinata tab reads only the materialized model API', () => {
  assert.match(runtime, /fetch\(HINATA_URL/);
  assert.match(runtime, /\/api\/hinata/);
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response/);
  assert.match(api, /HINATA_MODEL_KEY = 'hinata'/);
  assert.doesNotMatch(api, /\.prepare\(|OHISAMA_DB|MINUTE_DB|OTHER_DB/);
});

test('Hinata graph is rendered as five-minute buckets with actual five-minute stream growth', () => {
  assert.match(runtime, /const FIVE_MINUTES_MS = 5 \* 60_000/);
  assert.match(runtime, /Math\.floor\(observedAt \/ FIVE_MINUTES_MS\) \* FIVE_MINUTES_MS/);
  assert.match(runtime, /point\.bucket - previous\.bucket === FIVE_MINUTES_MS/);
  assert.match(runtime, /point\.stream_count - previous\.stream_count/);
  assert.match(shell, /再生数増加/);
  assert.match(shell, /5分単位/);
});

test('Hinata daily table matches history start and end cumulative columns', () => {
  assert.match(shell, /headers: \['日付', '平均同接', '最小同接', '最大同接', '再生数（開始）', '再生数（終了）', '再生数増加', 'メンバー数（開始）', 'メンバー数（終了）', 'メンバー増加数'\]/);
  assert.match(runtime, /numberText\(item\?\.stream_start\)/);
  assert.match(runtime, /numberText\(item\?\.stream_end\)/);
  assert.match(runtime, /numberText\(item\?\.member_start\)/);
  assert.match(runtime, /numberText\(item\?\.member_end\)/);
  assert.match(runtime, /appendEmptyTableRow\(tbody, '日次データはまだありません。', 10, \{ className: 'shared-empty' \}\)/);
  assert.match(sharedUi, /export function appendEmptyTableRow\(/);
});

test('Hinata UI includes the 24-hour online and playback graph plus daily metrics', () => {
  assert.match(runtime, /history_24h/);
  assert.match(runtime, /stream_delta_5m/);
  assert.match(runtime, /listener_avg/);
  assert.match(runtime, /stream_growth/);
  assert.match(runtime, /member_growth/);
});

test('Hinata daily chart mirrors history axes, line gaps and Canvas legend treatment', () => {
  const liveChartIndex = shell.indexOf('<canvas id="hinataChart"');
  const dailyChartIndex = shell.indexOf('<canvas id="hinataDailyChart"');
  const dailyDataIndex = shell.indexOf("title: '日次データ'");
  assert.ok(liveChartIndex >= 0);
  assert.ok(dailyChartIndex > liveChartIndex);
  assert.ok(dailyDataIndex > dailyChartIndex);
  assert.match(shell, /title: '同接・再生数増加の推移'/);
  assert.match(shell, /titleId: 'hinataDailyChartTitle'/);
  assert.match(shell, /aria-label="日次の平均・最大・最小同接と再生数増加"/);
  assert.match(runtime, /function renderDailyChart\(value\)/);
  assert.match(runtime, /listener_avg/);
  assert.match(runtime, /listener_max/);
  assert.match(runtime, /listener_min/);
  assert.match(runtime, /stream_growth/);
  assert.match(runtime, /maxGap: DAY_MS \* 1\.5/);
  assert.match(runtime, /appendDashboardLegendItem\('再生数増加', STREAM_BAR_COLOR/);
  assert.match(runtime, /renderDailyChart\(value\)/);
});