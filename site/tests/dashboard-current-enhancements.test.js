import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fetchCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../public/dashboard-current-layout.js', import.meta.url), 'utf8');
const chart = readFileSync(new URL('../public/dashboard-chart-comparison.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-current-enhancements.css', import.meta.url), 'utf8');
const tableCleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');

test('current metrics are ordered online, total streams and total members without a duplicate chart or fetch renderer', () => {
  assert.match(metrics, /dashboard-current-layout\.js\?v=20260923\.4/);
  assert.match(metrics, /dashboard-chart-comparison\.js\?v=20260923\.4/);
  assert.match(metrics, /dashboard-fetch-cache\.js\?v=20260923\.4/);
  assert.doesNotMatch(metrics, /dashboard-current-enhancements\.js/);
  assert.match(metrics, /dashboard-client\.js\?v=20260923\.4/);
  assert.match(header, /dashboard-current-enhancements\.css\?v=20260921\.4/);
  assert.doesNotMatch(metrics, /window\.fetch|response\.clone\(\)\.json|restoreDashboardCache/);
  assert.match(fetchCache, /dashboard:payload/);
  assert.match(layout, /\[onlinePanel, streamsPanel, membersPanel\]/);
  assert.doesNotMatch(layout, /audienceChart|getContext\('2d'\)|drawEnhancedChart/);
});

test('mobile dashboard tabs and metrics stay compact', () => {
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs/);
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /grid-template-rows:\s*repeat\(2, minmax\(32px, auto\)\) !important/);
  assert.match(css, /\.metrics\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /white-space:\s*nowrap !important/);
});

test('current chart draws numeric axes in black and green with JST labels from one renderer', () => {
  assert.match(chart, /オンライン数\(人\)/);
  assert.match(chart, /コメント\/2分/);
  assert.match(chart, /時刻 \(JST\)/);
  assert.match(chart, /timeZone: 'Asia\/Tokyo'/);
  assert.match(chart, /drawSeries\(context, current, xFor, yOnline, '#111', 2\.5\)/);
  assert.match(chart, /rgba\(22,139,115,\.42\)/);
  assert.match(chart, /const EXTREMA_POINT_COLOR = '#888'/);
  assert.match(chart, /if \(minRow\) \{[\s\S]*context\.fillStyle = EXTREMA_POINT_COLOR/);
  assert.match(chart, /if \(maxRow\) \{[\s\S]*context\.fillStyle = EXTREMA_POINT_COLOR/);
  assert.match(chart, /`最小 \$\{integer\.format\(currentMin\)\}（\$\{jstExtremaTime\.format/);
  assert.match(chart, /`最大 \$\{integer\.format\(currentMax\)\}（\$\{jstExtremaTime\.format/);
  assert.doesNotMatch(chart, /strokeRect\(/);
});

test('stream goal is moved into the metric and ETA is display-only JST', () => {
  assert.match(layout, /metricGoalCompact/);
  assert.match(layout, /jstGoalDateTime = new Intl\.DateTimeFormat[\s\S]*timeZone: 'Asia\/Tokyo'/);
  assert.match(layout, /jstGoalDateTime\.format/);
  assert.match(css, /\.goal-card\s*\{[\s\S]*display:\s*none !important/);
});

test('dashboard deltas are green and refresh label is not ellipsized', () => {
  assert.match(css, /\.metrics \.delta,[\s\S]*color:\s*#168b73 !important/);
  assert.match(css, /#updated[\s\S]*text-overflow:\s*clip !important/);
  assert.match(css, /#updated[\s\S]*white-space:\s*normal !important/);
});

test('history summary keeps total sample count and hides listener-valid sample count', () => {
  assert.match(tableCleanup, /\['記録数', \['取得記録数', 'その期間に保存された全サンプル数'\]\]/);
  assert.match(tableCleanup, /SUMMARY_REMOVED_LABELS[\s\S]*'有効記録数'[\s\S]*'同接有効数'/);
  assert.doesNotMatch(tableCleanup, /\['有効記録数', \['同接有効数'/);
});
