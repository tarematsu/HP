import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../public/monochrome.css', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const dashboardChart = readFileSync(new URL('../public/dashboard-current-enhancements.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const rankingChart = readFileSync(new URL('../public/history/history-ranking-chart.js', import.meta.url), 'utf8');

test('dashboard loads the monochrome UI theme before first paint', () => {
  const appLite = page.match(/\/app-lite\.css\?v=[^"']+/)?.[0];
  const monochrome = page.match(/\/monochrome\.css\?v=[^"']+/)?.[0];
  assert.ok(appLite, 'app-lite.css must have an explicit deployment version');
  assert.ok(monochrome, 'monochrome.css must have an explicit deployment version');
  assert.ok(page.indexOf(appLite) < page.indexOf(monochrome));
  assert.ok(page.indexOf(monochrome) < page.indexOf('</head>'));
  assert.doesNotMatch(header, /monochromeStylesheet|monochrome\.css/);
  assert.match(theme, /body\s*\{[\s\S]*--bg:\s*#ffffff[\s\S]*--accent:\s*#111111/);
  assert.match(theme, /\.button\.primary,[\s\S]*background:\s*#111111/);
  assert.match(theme, /\.mode-tabs button\.active,[\s\S]*background:\s*#111111/);
});

test('images are not desaturated by the monochrome theme', () => {
  assert.doesNotMatch(theme, /\bfilter\s*:/);
  assert.doesNotMatch(theme, /(?:\.channel-image|\.track-image|\bimg\b)[^{]*\{[^}]*filter/i);
});

test('canvas graph palette remains independent from monochrome UI overrides', () => {
  assert.doesNotMatch(theme, /:root\s*\{/);
  assert.match(dashboardChart, /context\.strokeStyle = '#111'/);
  assert.match(dashboardChart, /rgba\(22,139,115,\.32\)/);
  assert.match(periodChart, /getComputedStyle\(document\.documentElement\)/);
  assert.match(rankingChart, /getComputedStyle\(document\.documentElement\)/);
  assert.match(rankingChart, /\['sakuramankai', '#000000'\]/);
  assert.match(rankingChart, /\['sakurazaka46jp', '#d93f79'\]/);
  assert.match(theme, /\.legend \.online-key,[\s\S]*color:\s*#d93f79/);
  assert.match(theme, /\.legend \.comment-key\s*\{[\s\S]*color:\s*#168b73/);
  assert.match(theme, /\.legend \.legend-plays\s*\{[\s\S]*color:\s*#6657d8/);
  assert.match(theme, /\.legend \.legend-comments\s*\{[\s\S]*color:\s*#55d6be/);
});

test('Pages layout removes decorative chrome while keeping data sections', () => {
  assert.match(theme, /\.kicker,\s*\n\.channel-visual\s*\{[\s\S]*display:\s*none !important/);
  assert.match(theme, /\.top-card,\s*\n\.card,\s*\n\.metric,[\s\S]*border-radius:\s*0[\s\S]*box-shadow:\s*none/);
  assert.match(theme, /\.metrics\s*\{[\s\S]*border-bottom:\s*1px solid #e3e3e3/);
  assert.match(theme, /\.primary-grid\s*\{[\s\S]*gap:\s*0[\s\S]*border-bottom:\s*1px solid #e3e3e3/);
  assert.match(theme, /\.chart-detail:empty,\s*\n\.notice:empty\s*\{[\s\S]*display:\s*none/);
  assert.match(theme, /\.table-wrap\s*\{[\s\S]*border-radius:\s*0/);
});

test('redundant chart helper copy is cleared at startup and after rerenders', () => {
  assert.match(header, /CHART_HELPER_PREFIX = 'グラフをタッチ'/);
  assert.match(header, /clearChartHelperCopy/);
  assert.match(header, /startsWith\(CHART_HELPER_PREFIX\)/);
  assert.match(header, /\['currentChartDetail', 'chartDetail'\]/);
  assert.match(header, /new MutationObserver\(\(\) => clearChartHelperCopy\(element\)\)/);
  assert.match(header, /replaceChildren\(\)/);
});
