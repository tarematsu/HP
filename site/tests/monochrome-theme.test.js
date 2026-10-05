import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../public/monochrome.css', import.meta.url), 'utf8');
const assetBuild = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const dashboardChart = browserSource('stationhead-channel.js');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const rankingChart = browserSource('leaderboard.js');
const rankingModel = readFileSync(new URL('../public/leaderboard-read-model.js', import.meta.url), 'utf8');
const broadcastChart = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
const firstWeekShell = readFileSync(new URL('../public/first-week-comparison-shell.js', import.meta.url), 'utf8');
const firstWeekChart = readFileSync(new URL('../public/first-week-comparison.js', import.meta.url), 'utf8');

test('dashboard loads the monochrome UI theme in the first-paint CSS bundle', () => {
  const bundledCss = page.match(/\/assets\/dashboard\.min\.css\?v=[^"']+/)?.[0];
  assert.ok(bundledCss, 'dashboard.min.css must have an explicit deployment version');
  assert.ok(page.indexOf(bundledCss) < page.indexOf('</head>'));
  assert.match(assetBuild, /'app-lite\.css'/);
  assert.match(assetBuild, /'monochrome\.css'/);
  assert.ok(assetBuild.indexOf("'app-lite.css'") < assetBuild.indexOf("'monochrome.css'"));
  assert.doesNotMatch(header, /monochromeStylesheet|monochrome\.css/);
  assert.match(theme, /body\s*\{[\s\S]*--bg:\s*#fff[\s\S]*--accent:\s*#111/);
  assert.match(theme, /\.button\.primary,[\s\S]*background:\s*var\(--text\)/);
  assert.match(theme, /\.mode-tabs :is\(button, a\)\.active/);
});

test('images are not desaturated by the monochrome theme', () => {
  assert.doesNotMatch(theme, /\bfilter\s*:/);
  assert.doesNotMatch(theme, /(?:\.channel-image|\.track-image|\bimg\b)[^{]*\{[^}]*filter/i);
});

test('canvas graph palette remains independent from monochrome UI overrides', () => {
  assert.doesNotMatch(theme, /:root\s*\{/);
  assert.match(dashboardChart, /drawOnlineSeries\(context, rows, x, y, '#111', 2\)/);
  assert.match(periodChart, /cssColor/);
  assert.match(rankingChart, /cssColor/);
  assert.doesNotMatch(periodChart, /getComputedStyle\(document\.documentElement\)/);
  assert.doesNotMatch(rankingChart, /getComputedStyle\(document\.documentElement\)/);
  assert.match(rankingModel, /sakuramankai: '#111111'/);
  assert.match(rankingModel, /sakurazaka46jp: '#d93f79'/);
  assert.match(theme, /\.legend \.online-key,[\s\S]*color:\s*#111/);
  assert.match(theme, /\.legend \.comment-key\s*\{[\s\S]*color:\s*#168b73/);
  assert.match(theme, /\.legend \.legend-plays\s*\{[\s\S]*color:\s*#6657d8/);
  assert.match(theme, /\.legend \.legend-comments\s*\{[\s\S]*color:\s*#55d6be/);
});

test('shared core removes decorative chrome while keeping data sections', () => {
  const base = readFileSync(new URL('../public/app-lite.css', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
  assert.match(theme, /\.kicker,[\s\S]*\.channel-visual[\s\S]*display:\s*none/);
  assert.match(base, /\.top-card, \.card, \.metric[\s\S]*box-shadow:\s*none/);
  assert.match(layout, /\.metrics,[\s\S]*border-bottom: 1px solid var\(--line\)/);
  assert.match(layout, /\.table-wrap[\s\S]*border-radius: 0/);
});

test('chart helper copy is removed from source instead of hidden after render', () => {
  for (const source of [page, header, broadcastChart, firstWeekShell, firstWeekChart]) {
    assert.doesNotMatch(source, /グラフをタッチ/);
  }
  assert.doesNotMatch(header, /CHART_HELPER_PREFIX|clearChartHelperCopy/);
  assert.match(broadcastChart, /if \(minute == null\) \{\s*detail\.replaceChildren\(\)/);
  assert.match(firstWeekChart, /if \(selectedMinute == null\) \{\s*detail\.replaceChildren\(\)/);
});
