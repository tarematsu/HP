import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const navigationCss = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const musicServiceShell = readFileSync(new URL('../public/music-service-shell.js', import.meta.url), 'utf8');
const canvasChart = readFileSync(new URL('../public/dashboard-chart-canvas.js', import.meta.url), 'utf8');
const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const stationheadRuntime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const stationheadReadModel = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');
const stationheadStyles = readFileSync(new URL('../public/stationhead-channel-style-loader.js', import.meta.url), 'utf8');
const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const hinataShell = readFileSync(new URL('../public/hinata-shell.js', import.meta.url), 'utf8');
const nogizakaShell = readFileSync(new URL('../public/nogizaka-listening-party-shell.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');
const broadcastsChart = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
const rankChart = readFileSync(new URL('../public/dashboard-rank-chart.js', import.meta.url), 'utf8');
const tableDom = readFileSync(new URL('../public/dashboard-table-dom.js', import.meta.url), 'utf8');
const historyToggle = readFileSync(new URL('../public/history/history-past-toggle-shell.js', import.meta.url), 'utf8');

const runtimes = Object.fromEntries([
  'amazon-music.js', 'apple-music.js', 'followers.js', 'spotify.js', 'played-tracks.js', 'first-week-comparison.js',
].map((file) => [file, readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8')]));

test('dashboard exposes reusable presentation components in one shared module', () => {
  for (const helper of [
    'dashboardMetric', 'dashboardMetrics', 'dashboardSummaryItem', 'dashboardSummary', 'dashboardSectionHead',
    'dashboardLegend', 'dashboardChartCard', 'dashboardChartHost', 'dashboardTable', 'dashboardModeTabs',
    'dashboardDataCard', 'dashboardControls', 'dashboardNotice', 'mountDashboardView', 'mountDashboardShell',
  ]) assert.match(sharedUi, new RegExp(`export function ${helper}\\(`));
});

test('dashboard exposes shared runtime primitives for repeated view rendering work', () => {
  for (const helper of ['signedInteger', 'evenlySpacedIndexes', 'appendEmptyState']) assert.match(sharedUi, new RegExp(`export function ${helper}\\(`));
  for (const helper of ['prepareDashboardCanvas', 'drawDashboardGrid', 'drawDashboardLine', 'drawDashboardXAxis', 'dashboardTickIndexes']) assert.match(canvasChart, new RegExp(`export function ${helper}\\(`));
  assert.match(rankChart, /appendEmptyState/);
  assert.match(rankChart, /drawDashboardLine/);
  assert.match(rankChart, /prepareDashboardCanvas/);
  assert.match(tableDom, /export function appendTableRow/);
  assert.match(tableDom, /export function replaceTableHeader/);
});

test('all active client Canvas charts reuse the shared Canvas foundation', () => {
  const sources = {
    historyPeriod: periodChart,
    historyRanking: rankingChart,
    historyBroadcasts: broadcastsChart,
    spotify: runtimes['spotify.js'],
    subscriptionRank: rankChart,
    followers: runtimes['followers.js'],
    firstWeek: runtimes['first-week-comparison.js'],
    stationhead: stationheadRuntime,
  };
  assert.match(canvasChart, /getContext\('2d'\)/);
  assert.match(canvasChart, /window\.devicePixelRatio/);
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /dashboard-chart-canvas\.js\?v=20261001\.[12]/, `${name} must import the shared Canvas foundation`);
    assert.match(source, /prepareDashboardCanvas/, `${name} must share Canvas sizing and DPR setup`);
    assert.doesNotMatch(source, /getContext\('2d'\)/, `${name} must not initialize Canvas independently`);
    assert.doesNotMatch(source, /window\.devicePixelRatio/, `${name} must not own DPR logic`);
  }
});

test('Buddies Ohisama and Nogizaka share one HTML shell and one JS runtime', () => {
  for (const source of [currentShell, hinataShell, nogizakaShell]) {
    assert.match(source, /mountStationheadChannelShell/);
    assert.doesNotMatch(source, /dashboardMetric|dashboardChartCard|dashboardTable|stationheadPlaybackCards/);
  }
  assert.match(currentShell, /stationheadModel = 'buddies'/);
  assert.match(hinataShell, /stationheadModel = 'ohisama'/);
  assert.match(nogizakaShell, /stationheadModel = 'nogizaka'/);
  assert.match(stationheadShell, /export function stationheadChannelMarkup\(/);
  assert.match(stationheadShell, /dashboardModeTabs/);
  assert.match(stationheadRuntime, /stationheadChannelReadModel/);
  assert.doesNotMatch(stationheadRuntime, /\/api\/(?:hinata|nogizaka-listening-party)|artist_filter|stationhead\.com\/c\//);
  assert.match(stationheadReadModel, /function buddiesModel\(\)/);
  assert.match(stationheadReadModel, /function ohisamaModel\(\)/);
  assert.match(stationheadReadModel, /function nogizakaModel\(\)/);
});

test('Stationhead shared shell owns notices tables legends and five mode tabs once', () => {
  assert.match(stationheadShell, /role\('notice'\)/);
  assert.match(stationheadShell, /class="legend" \$\{role\('daily-legend'\)\}/);
  assert.match(stationheadShell, /class="table-wrap"/);
  assert.match(stationheadShell, /className: 'stationhead-subtabs'/);
  for (const section of ['current', 'history', 'played-tracks', 'likes', 'broadcasts']) assert.match(stationheadShell, new RegExp(`data-stationhead-panel=\\"${section}\\"`));
  assert.match(sharedCss, /\.stationhead-channel-panel/);
  assert.match(navigationCss, /\.stationhead-subtabs/);
});

test('Stationhead secondary CSS is loaded by one shared lazy style loader', () => {
  assert.doesNotMatch(sharedUi, /ensureStylesheet|createElement\('link'\)/);
  assert.match(stationheadStyles, /ensureDashboardSectionStyles/);

  assert.doesNotMatch(currentShell, /\.css\?v=|createElement\('link'\)/);
  assert.doesNotMatch(hinataShell, /\.css\?v=|createElement\('link'\)/);
  assert.doesNotMatch(nogizakaShell, /\.css\?v=|createElement\('link'\)/);
});

test('Hinata and followers use the same lazy route registry as other tabs', () => {
  for (const mode of ['hinata', 'followers']) assert.match(sharedRoute, new RegExp(`${mode}: \\{`));
  assert.match(sharedRoute, /const VIEW_IDS = \['currentView', 'historyView', \.\.\.Object\.values\(LAZY_VIEWS\)/);
});

test('music-service shell remains the shared implementation for regional streaming services', () => {
  for (const helper of ['musicServiceMeta', 'musicServiceNotice', 'musicServiceViewClassName', 'musicServiceFilterTabs', 'musicServiceTable', 'musicServiceSection', 'mountMusicServiceView']) assert.match(musicServiceShell, new RegExp(`export function ${helper}\\(`));
  assert.match(musicServiceShell, /dashboardModeTabs/);
  assert.match(musicServiceShell, /dashboardTable/);
});

test('history feature shells rely on the bundled stylesheet contract', () => {
  assert.doesNotMatch(historyToggle, /dashboard-ui-common\.js|ensureStylesheet|\.css\?v=|createElement\('link'\)/);
  assert.match(historyToggle, /function mountPastWeekToggle/);
});
