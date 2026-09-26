import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fetchCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../public/dashboard-current-layout.js', import.meta.url), 'utf8');
const chart = readFileSync(new URL('../public/dashboard-chart-comparison.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-current-enhancements.css', import.meta.url), 'utf8');
const finalFixes = readFileSync(new URL('../public/pages-layout-final-fixes.css', import.meta.url), 'utf8');
const tableCleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');

test('current metrics are statically ordered online, total streams and total members without a duplicate chart or fetch renderer', () => {
  assert.match(metrics, /dashboard-current-layout\.js\?v=20260924\.1/);
  assert.match(metrics, /dashboard-chart-comparison\.js\?v=20260923\.6/);
  assert.match(metrics, /dashboard-fetch-cache\.js\?v=20260923\.4/);
  assert.doesNotMatch(metrics, /dashboard-current-enhancements\.js/);
  assert.match(metrics, /dashboard-client\.js\?v=20260924\.1/);
  assert.match(header, /dashboard-current-enhancements\.css\?v=20260924\.1/);
  assert.match(header, /pages-layout-final-fixes\.css\?v=20260925\.1/);
  assert.doesNotMatch(metrics, /window\.fetch|response\.clone\(\)\.json|restoreDashboardCache/);
  assert.match(fetchCache, /dashboard:payload/);
  assert.ok(html.indexOf('id="online"') < html.indexOf('id="totalStreams"'));
  assert.ok(html.indexOf('id="totalStreams"') < html.indexOf('id="members"'));
  assert.doesNotMatch(layout, /append\(|insertAdjacent|MutationObserver|goal-card|audienceChart|getContext\('2d'\)|drawEnhancedChart/);
});

test('mobile dashboard tabs stay compact while current metrics stay in one horizontal row', () => {
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs/);
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /grid-template-rows:\s*repeat\(2, minmax\(32px, auto\)\) !important/);
  assert.match(finalFixes, /#currentView > \.metrics\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.doesNotMatch(finalFixes, /#currentView > \.metrics\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) !important/);
  assert.match(css, /white-space:\s*nowrap !important/);
});

test('current chart draws online axes and JST labels from one renderer', () => {
  assert.match(chart, /オンライン数\(人\)/);
  assert.doesNotMatch(chart, /コメント\/2分|comment_velocity|commentVelocity|rgba\(22,139,115/);
  assert.match(chart, /時刻 \(JST\)/);
  assert.match(chart, /timeZone: 'Asia\/Tokyo'/);
  assert.match(chart, /drawSeries\(context, current, xFor, yOnline, '#111', 2\.5\)/);
  assert.match(chart, /const EXTREMA_POINT_COLOR = '#888'/);
  assert.match(chart, /if \(minRow\) \{[\s\S]*context\.fillStyle = EXTREMA_POINT_COLOR/);
  assert.match(chart, /if \(maxRow\) \{[\s\S]*context\.fillStyle = EXTREMA_POINT_COLOR/);
  assert.match(chart, /`最小 \$\{integer\.format\(currentMin\)\}（\$\{jstExtremaTime\.format/);
  assert.match(chart, /`最大 \$\{integer\.format\(currentMax\)\}（\$\{jstExtremaTime\.format/);
  assert.doesNotMatch(chart, /strokeRect\(/);
});

test('stream goal is static inside the metric and ETA is display-only JST', () => {
  assert.match(html, /id="metricGoalCompact"/);
  assert.match(html, /id="streamGoal"/);
  assert.match(html, /id="goalEta"/);
  assert.doesNotMatch(html, /goal-card|id="streamCount"|id="goalBar"|id="goalPercent"|id="goalRemaining"|id="goalRate"|id="goalMilestones"/);
  assert.match(layout, /jstGoalDateTime = new Intl\.DateTimeFormat[\s\S]*timeZone: 'Asia\/Tokyo'/);
  assert.match(layout, /jstGoalDateTime\.format/);
  assert.doesNotMatch(css, /\.goal-card/);
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
