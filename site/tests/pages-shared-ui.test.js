import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const canvasChart = readFileSync(new URL('../public/dashboard-chart-canvas.js', import.meta.url), 'utf8');
const currentChart = readFileSync(new URL('../public/dashboard-chart-comparison.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');
const broadcastsChart = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
const rankChart = readFileSync(new URL('../public/dashboard-rank-chart.js', import.meta.url), 'utf8');
const tableDom = readFileSync(new URL('../public/dashboard-table-dom.js', import.meta.url), 'utf8');
const historyToggle = readFileSync(new URL('../public/history/history-past-toggle-shell.js', import.meta.url), 'utf8');

const shellFiles = [
  'current-shell.js',
  'history-shell.js',
  'likes-shell.js',
  'hinata-shell.js',
  'followers-shell.js',
  'spotify-shell.js',
  'apple-music-shell.js',
  'amazon-music-shell.js',
  'played-tracks-shell.js',
  'first-week-comparison-shell.js',
  'nogizaka-listening-party-shell.js',
];
const shells = Object.fromEntries(shellFiles.map((file) => [
  file,
  readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'),
]));
const runtimeFiles = [
  'amazon-music.js',
  'apple-music.js',
  'followers.js',
  'spotify.js',
  'hinata.js',
  'played-tracks.js',
  'first-week-comparison.js',
  'nogizaka-listening-party.js',
];
const runtimes = Object.fromEntries(runtimeFiles.map((file) => [
  file,
  readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'),
]));

const hinataCss = readFileSync(new URL('../public/hinata.css', import.meta.url), 'utf8');
const followersCss = readFileSync(new URL('../public/followers.css', import.meta.url), 'utf8');
const amazonCss = readFileSync(new URL('../public/amazon-music.css', import.meta.url), 'utf8');
const appleCss = readFileSync(new URL('../public/apple-music.css', import.meta.url), 'utf8');
const spotifyCss = readFileSync(new URL('../public/spotify.css', import.meta.url), 'utf8');

test('dashboard exposes reusable presentation components in one shared module', () => {
  for (const helper of [
    'dashboardMetric',
    'dashboardMetrics',
    'dashboardSummaryItem',
    'dashboardSummary',
    'dashboardSectionHead',
    'dashboardLegend',
    'dashboardChartCard',
    'dashboardChartHost',
    'dashboardTable',
    'dashboardModeTabs',
    'dashboardDataCard',
    'dashboardControls',
    'dashboardNotice',
  ]) assert.match(sharedUi, new RegExp(`export function ${helper}\\(`));
});

test('dashboard exposes shared runtime primitives for repeated view rendering work', () => {
  for (const helper of ['signedInteger', 'evenlySpacedIndexes', 'appendEmptyState']) {
    assert.match(sharedUi, new RegExp(`export function ${helper}\\(`));
  }
  for (const helper of ['prepareDashboardCanvas', 'drawDashboardGrid', 'drawDashboardLine', 'drawDashboardXAxis', 'dashboardTickIndexes']) {
    assert.match(canvasChart, new RegExp(`export function ${helper}\\(`));
  }
  assert.match(rankChart, /appendEmptyState/);
  assert.match(rankChart, /drawDashboardLine/);
  assert.match(rankChart, /prepareDashboardCanvas/);
  assert.doesNotMatch(rankChart, /svgElement|evenlySpacedIndexes/);
  for (const name of ['amazon-music.js', 'apple-music.js']) {
    assert.match(runtimes[name], /renderRankHistoryChart/);
    assert.doesNotMatch(runtimes[name], /appendEmptyState|evenlySpacedIndexes|svgElement/);
  }
  assert.match(runtimes['followers.js'], /appendEmptyState/);
  assert.match(runtimes['followers.js'], /drawDashboardXAxis/);
  assert.match(runtimes['followers.js'], /drawDashboardLine/);
  assert.match(runtimes['spotify.js'], /appendEmptyState/);
  assert.match(runtimes['spotify.js'], /drawDashboardGrid/);
  assert.match(runtimes['spotify.js'], /drawDashboardLine/);
  assert.match(runtimes['spotify.js'], /prepareDashboardCanvas/);
  assert.doesNotMatch(runtimes['spotify.js'], /svgElement|evenlySpacedIndexes/);
  for (const name of ['amazon-music.js', 'followers.js', 'spotify.js']) {
    assert.match(runtimes[name], /signedInteger/);
    assert.doesNotMatch(runtimes[name], /function formatDelta\s*\(/);
  }
  assert.match(tableDom, /export function appendTableRow/);
  assert.match(tableDom, /export function replaceTableHeader/);
  assert.doesNotMatch(runtimes['followers.js'], /function (?:appendText|tickIndexes)\s*\(/);
});

test('all client Canvas charts reuse the single dashboard canvas foundation', () => {
  const sources = {
    current: currentChart,
    historyPeriod: periodChart,
    historyRanking: rankingChart,
    historyBroadcasts: broadcastsChart,
    spotify: runtimes['spotify.js'],
    subscriptionRank: rankChart,
    ohisama: runtimes['hinata.js'],
    followers: runtimes['followers.js'],
    playedTracks: runtimes['played-tracks.js'],
    firstWeek: runtimes['first-week-comparison.js'],
    nogizakaParty: runtimes['nogizaka-listening-party.js'],
  };
  assert.match(canvasChart, /getContext\('2d'\)/);
  assert.match(canvasChart, /window\.devicePixelRatio/);
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /dashboard-chart-canvas\.js\?v=20261001\.[12]/, `${name} must import the shared Canvas foundation`);
    assert.match(source, /prepareDashboardCanvas/, `${name} must share Canvas sizing and DPR setup`);
    assert.doesNotMatch(source, /getContext\('2d'\)/, `${name} must not initialize Canvas independently`);
    assert.doesNotMatch(source, /window\.devicePixelRatio/, `${name} must not own DPR logic`);
  }
  for (const source of [currentChart, periodChart, rankingChart, broadcastsChart, runtimes['spotify.js'], rankChart, runtimes['hinata.js'], runtimes['followers.js'], runtimes['first-week-comparison.js'], runtimes['nogizaka-listening-party.js']]) {
    assert.match(source, /drawDashboardLine/);
  }
  for (const source of [currentChart, periodChart, rankingChart, broadcastsChart, runtimes['spotify.js'], rankChart, runtimes['hinata.js'], runtimes['followers.js'], runtimes['first-week-comparison.js'], runtimes['nogizaka-listening-party.js']]) {
    assert.match(source, /drawDashboardGrid/);
  }
});

test('all dashboard shells share mounting and reusable UI components without runtime stylesheet loading', () => {
  assert.doesNotMatch(sharedUi, /ensureStylesheet|createElement\('link'\)/);
  assert.match(sharedUi, /export function mountDashboardTab/);
  assert.match(sharedUi, /export function mountDashboardView/);
  assert.match(sharedUi, /export function mountDashboardShell/);

  for (const [name, source] of Object.entries(shells)) {
    assert.match(source, /dashboard-ui-common\.js\?v=20261001\.1/, `${name} must import shared UI helpers`);
    assert.match(source, /mountDashboardShell\(/, `${name} must use the common shell mount`);
    assert.doesNotMatch(source, /\.css\?v=|style:\s*\{|function ensureStylesheet\s*\(/, `${name} must rely on the CSS bundle`);
    assert.doesNotMatch(source, /function mountTab\s*\(/, `${name} must not reimplement tab mounting`);
    assert.doesNotMatch(source, /function mountView\s*\(/, `${name} must not reimplement view mounting`);
  }

  for (const name of ['current-shell.js', 'hinata-shell.js']) {
    assert.match(shells[name], /dashboardMetric/);
    assert.match(shells[name], /dashboardMetrics/);
  }
  for (const name of ['history-shell.js', 'likes-shell.js', 'spotify-shell.js', 'apple-music-shell.js', 'played-tracks-shell.js', 'nogizaka-listening-party-shell.js']) {
    assert.match(shells[name], /dashboard(?:Summary|DataCard|ChartCard)/, `${name} must compose shared cards`);
  }
  for (const name of ['followers-shell.js', 'apple-music-shell.js', 'amazon-music-shell.js']) {
    assert.match(shells[name], /dashboardChartHost/, `${name} must use the shared chart host`);
  }
  assert.match(shells['hinata-shell.js'], /<canvas id="hinataChart"/);
  assert.match(shells['hinata-shell.js'], /<canvas id="hinataDailyChart"/);
  assert.doesNotMatch(shells['hinata-shell.js'], /dashboardChartHost/, 'hinata-shell.js must use the canonical Canvas chart path');
});

test('dashboard shells reuse shared notices tables legends and mode tabs instead of duplicating markup', () => {
  const noticeShells = [
    'history-shell.js', 'likes-shell.js', 'hinata-shell.js', 'followers-shell.js', 'spotify-shell.js',
    'apple-music-shell.js', 'amazon-music-shell.js', 'played-tracks-shell.js',
    'first-week-comparison-shell.js', 'nogizaka-listening-party-shell.js',
  ];
  for (const name of noticeShells) {
    assert.match(shells[name], /dashboardNotice/, `${name} must use the shared notice primitive`);
    assert.doesNotMatch(shells[name], /class="notice"\s+role="status"/, `${name} must not hand-write notice markup`);
  }

  const tableShells = [
    'history-shell.js', 'likes-shell.js', 'hinata-shell.js', 'followers-shell.js', 'spotify-shell.js',
    'apple-music-shell.js', 'amazon-music-shell.js', 'played-tracks-shell.js',
    'first-week-comparison-shell.js', 'nogizaka-listening-party-shell.js',
  ];
  for (const name of tableShells) {
    assert.match(shells[name], /dashboardTable/, `${name} must use the shared table primitive`);
    assert.doesNotMatch(shells[name], /<div class="table-wrap/, `${name} must not hand-write table wrappers`);
  }

  for (const name of ['history-shell.js', 'hinata-shell.js', 'followers-shell.js', 'apple-music-shell.js', 'first-week-comparison-shell.js', 'nogizaka-listening-party-shell.js']) {
    assert.match(shells[name], /dashboardLegend/, `${name} must use the shared legend primitive`);
  }
  assert.match(shells['spotify-shell.js'], /dashboardModeTabs/);
  assert.doesNotMatch(shells['spotify-shell.js'], /<div class="mode-tabs">/);
});

test('Hinata and followers use the same lazy route registry as other tabs', () => {
  for (const mode of ['hinata', 'followers']) assert.match(sharedRoute, new RegExp(`${mode}: \\{`));
  assert.match(sharedRoute, /const VIEW_IDS = \['currentView', 'historyView', \.\.\.Object\.values\(LAZY_VIEWS\)/);
});

test('shared feature CSS owns generic chart-host and numeric-table primitives', () => {
  assert.match(sharedCss, /\.shared-svg-chart\s*\{/);
  assert.match(sharedCss, /\.shared-svg-chart :is\(svg, canvas\)/);
  assert.match(sharedCss, /\.shared-dashboard-canvas/);
  assert.match(sharedCss, /\.shared-numeric-table th/);
  assert.match(sharedCss, /font-variant-numeric:\s*tabular-nums/);
  for (const emptyClass of ['apple-rank-empty', 'amazon-rank-empty', 'followers-empty', 'spotify-trend-empty']) {
    assert.match(sharedCss, new RegExp(`\\.${emptyClass}`), `${emptyClass} must inherit the shared empty-state contract`);
  }
  for (const [name, source] of Object.entries({ hinataCss, followersCss, amazonCss, appleCss })) {
    assert.doesNotMatch(source, /\.\w+-view\s*\{[^}]*display:\s*grid/, `${name} must use canonical dashboard view layout`);
    assert.doesNotMatch(source, /\.\w+-view\[hidden\]/, `${name} must use canonical hidden-view behavior`);
  }
  assert.doesNotMatch(hinataCss, /\.hinata-metric|\.hinata-section-head|\.hinata-chart-detail/);

  assert.doesNotMatch(appleCss, /\.apple-rank-(?:grid|axis-label)\s*\{/);
  assert.doesNotMatch(appleCss, /\.apple-rank-line\s*\{[^}]*stroke-width:/s);
  assert.doesNotMatch(amazonCss, /\.amazon-rank-(?:grid|axis-label)\s*\{/);
  assert.doesNotMatch(amazonCss, /\.amazon-rank-line\s*\{[^}]*stroke-width:/s);
  assert.doesNotMatch(followersCss, /\.followers-(?:grid-line|axis-label|line)\s*\{/);
  assert.doesNotMatch(followersCss, /\.followers-endpoint\s*\{[^}]*stroke-width:/s);
  assert.doesNotMatch(spotifyCss, /\.spotify-trend-empty\s*\{[^}]*(?:margin|color|font-size):/s);
});

test('history feature shells rely on the single bundled stylesheet', () => {
  assert.doesNotMatch(historyToggle, /dashboard-ui-common\.js|ensureStylesheet|\.css\?v=|createElement\('link'\)/);
  assert.match(historyToggle, /function mountPastWeekToggle/);
});