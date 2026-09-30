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
const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');

test('current metrics are statically ordered while current-only renderers load lazily without duplicates', () => {
  assert.match(metrics, /dashboard-current-layout\.js\?v=20260924\.1/);
  assert.match(metrics, /dashboard-chart-stability\.js\?v=20260930\.2/);
  assert.match(metrics, /dashboard-chart-comparison\.js\?v=20260930\.2/);
  assert.match(metrics, /dashboard-chart-detail\.js\?v=20260930\.2/);
  assert.match(metrics, /dashboard-daily-summaries\.js\?v=20260930\.2/);
  assert.match(metrics, /dashboard-fetch-cache\.js\?v=20260930\.1/);
  assert.doesNotMatch(metrics, /dashboard-current-enhancements\.js|dashboard-details-client\.js/);
  assert.match(metrics, /dashboard-client\.js\?v=20260930\.2/);
  assert.match(metrics, /function ensureCurrentRuntime\(\)/);
  assert.doesNotMatch(metrics, /replayCurrentPayload|runtime-replay/);
  assert.doesNotMatch(header, /\.css\?v=|createElement\('link'\)/);
  assert.doesNotMatch(metrics, /window\.fetch|response\.clone\(\)\.json|restoreDashboardCache/);
  assert.match(fetchCache, /dashboard:payload/);
  assert.ok(html.indexOf('id="online"') < html.indexOf('id="totalStreams"'));
  assert.ok(html.indexOf('id="totalStreams"') < html.indexOf('id="members"'));
  assert.doesNotMatch(layout, /append\(|insertAdjacent|MutationObserver|goal-card|audienceChart|getContext\('2d'\)|drawEnhancedChart/);
});

test('shared mobile layout owns tab count and current metric columns', () => {
  assert.match(sharedLayout, /#modeTabs\.mode-tabs\.dashboard-tabs[\s\S]*repeat\(8, minmax\(0, 1fr\)\) !important/);
  assert.match(sharedLayout, /\.metrics\s*\{[\s\S]*repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.doesNotMatch(sharedLayout, /#currentView/);
  assert.match(sharedLayout, /@media \(max-width: 760px\)[\s\S]*grid-template-rows:\s*minmax\(44px, auto\) !important/);
});

test('current chart draws online axes, direct five-minute playback bars and JST labels from one renderer', () => {
  assert.match(chart, /オンライン数\(人\)/);
  assert.match(chart, /context\.fillText\('再生数'/);
  assert.match(chart, /stream\.textContent = '再生数'/);
  assert.match(chart, /stream_5m_history/);
  assert.match(chart, /drawStreamBars/);
  assert.doesNotMatch(chart, /再生数増加\/分（5分平均）|stream_minute_history|コメント\/2分|comment_velocity|commentVelocity|rgba\(22,139,115/);
  assert.match(chart, /時刻 \(JST\)/);
  assert.match(chart, /timeZone: 'Asia\/Tokyo'/);
  assert.match(chart, /drawSeries\(context, current, xFor, yOnline, '#111', 2\)/);
  assert.match(chart, /const EXTREMA_POINT_COLOR = '#888'/);
  assert.match(chart, /if \(minRow\) \{[\s\S]*context\.fillStyle = EXTREMA_POINT_COLOR/);
  assert.match(chart, /if \(maxRow\) \{[\s\S]*context\.fillStyle = EXTREMA_POINT_COLOR/);
  assert.match(chart, /`最小 \$\{integer\.format\(currentMin\)\}（\$\{jstTime\.format/);
  assert.match(chart, /`最大 \$\{integer\.format\(currentMax\)\}（\$\{jstTime\.format/);
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

test('history summary keeps total sample count and never renders listener-valid sample count', () => {
  assert.match(history, /\['sample_count', '取得記録数', 'その期間に保存された全サンプル数'\]/);
  assert.doesNotMatch(history, /\['reliable_sample_count'|有効記録数|同接有効数/);
});
