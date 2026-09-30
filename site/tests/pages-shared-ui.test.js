import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../public/dashboard-standalone-route.js', import.meta.url), 'utf8');
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

const hinataRoute = readFileSync(new URL('../public/dashboard-hinata-route.js', import.meta.url), 'utf8');
const followersRoute = readFileSync(new URL('../public/dashboard-followers-route.js', import.meta.url), 'utf8');
const hinataCss = readFileSync(new URL('../public/hinata.css', import.meta.url), 'utf8');
const followersCss = readFileSync(new URL('../public/followers.css', import.meta.url), 'utf8');
const amazonCss = readFileSync(new URL('../public/amazon-music.css', import.meta.url), 'utf8');
const appleCss = readFileSync(new URL('../public/apple-music.css', import.meta.url), 'utf8');

test('dashboard exposes reusable presentation components in one shared module', () => {
  for (const helper of [
    'dashboardMetric',
    'dashboardMetrics',
    'dashboardSummaryItem',
    'dashboardSummary',
    'dashboardSectionHead',
    'dashboardLegend',
    'dashboardChartCard',
    'dashboardTable',
    'dashboardDataCard',
    'dashboardControls',
  ]) assert.match(sharedUi, new RegExp(`export function ${helper}\\(`));
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
});

test('standalone lazy tabs share route activation and navigation handling', () => {
  assert.match(sharedRoute, /export function registerStandaloneDashboardRoute/);
  for (const [name, source] of Object.entries({ hinataRoute, followersRoute })) {
    assert.match(source, /dashboard-standalone-route\.js\?v=20260930\.1/, `${name} must import shared routing`);
    assert.match(source, /registerStandaloneDashboardRoute\(/);
    assert.doesNotMatch(source, /addEventListener\('popstate'/);
    assert.doesNotMatch(source, /addEventListener\('hashchange'/);
    assert.doesNotMatch(source, /document\.addEventListener\('click'/);
  }
});

test('shared feature CSS owns generic SVG and numeric-table primitives', () => {
  assert.match(sharedCss, /\.shared-svg-chart\s*\{/);
  assert.match(sharedCss, /\.shared-svg-chart svg\s*\{/);
  assert.match(sharedCss, /\.shared-numeric-table th/);
  assert.match(sharedCss, /font-variant-numeric:\s*tabular-nums/);

  for (const [name, source] of Object.entries({ hinataCss, followersCss, amazonCss, appleCss })) {
    assert.doesNotMatch(source, /\.\w+-view\s*\{[^}]*display:\s*grid/, `${name} must use canonical dashboard view layout`);
    assert.doesNotMatch(source, /\.\w+-view\[hidden\]/, `${name} must use canonical hidden-view behavior`);
  }
  assert.doesNotMatch(hinataCss, /\.hinata-metric|\.hinata-section-head|\.hinata-chart-detail/);
});

test('history feature shells rely on the single bundled stylesheet', () => {
  assert.doesNotMatch(historyToggle, /dashboard-ui-common\.js|ensureStylesheet|\.css\?v=|createElement\('link'\)/);
  assert.match(historyToggle, /function mountPastWeekToggle/);
});
