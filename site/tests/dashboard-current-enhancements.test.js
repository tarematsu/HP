import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const sharedShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const stationheadRuntime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fetchCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../public/dashboard-current-layout.js', import.meta.url), 'utf8');
const chart = readFileSync(new URL('../public/dashboard-chart-comparison.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-current-enhancements.css', import.meta.url), 'utf8');
const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');

test('current Stationhead renderer and markup are shared instead of Buddies-specific', () => {
  assert.match(metrics, /stationhead-channel\.js\?v=/);
  assert.match(metrics, /function ensureCurrentRuntime\(\)/);
  assert.match(currentShell, /mountStationheadChannelShell/);
  assert.match(currentShell, /stationheadModel = 'buddies'/);
  assert.match(sharedShell, /data-role="online"/);
  assert.match(sharedShell, /data-role="streams"/);
  assert.match(sharedShell, /data-role="members"/);
  assert.ok(sharedShell.indexOf('data-role="online"') < sharedShell.indexOf('data-role="streams"'));
  assert.ok(sharedShell.indexOf('data-role="streams"') < sharedShell.indexOf('data-role="members"'));
  assert.match(stationheadRuntime, /function renderCurrent\(/);
  assert.match(stationheadRuntime, /function renderCurrentChart\(/);
  assert.doesNotMatch(metrics, /dashboard-current-layout\.js|dashboard-chart-stability\.js|dashboard-chart-comparison\.js|dashboard-chart-detail\.js|dashboard-daily-summaries\.js|dashboard-fetch-cache\.js|dashboard-client\.js/);
  assert.doesNotMatch(header, /\.css\?v=|createElement\('link'\)/);
  assert.doesNotMatch(metrics, /window\.fetch|response\.clone\(\)\.json|restoreDashboardCache/);
  assert.match(fetchCache, /dashboard:payload/);
  assert.doesNotMatch(layout, /append\(|insertAdjacent|MutationObserver|goal-card|audienceChart|getContext\('2d'\)|drawEnhancedChart/);
});

test('shared mobile layout owns tab count and current metric columns', () => {
  assert.match(sharedLayout, /\.metrics\s*\{[\s\S]*repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.doesNotMatch(sharedLayout, /#currentView/);
});

test('current chart fully overlays direct five-minute playback bars on the online plot', () => {
  assert.match(chart, /オンライン数（人）/);
  assert.match(chart, /context\.fillText\('再生数増加'/);
  assert.match(chart, /stream\.textContent = '再生数増加'/);
  assert.match(chart, /stream_5m_history/);
  assert.match(chart, /drawStreamBars/);
  assert.match(chart, /const plotHeight = Math\.max\(1, height - padding\.top - padding\.bottom\)/);
  assert.match(chart, /const yStream = \(value\) => plotBottom - Math\.max\(0, Number\(value\)\) \* plotHeight \/ streamMax/);
  assert.match(chart, /drawStreamBars\(context, streamAverages, xFor, yStream, plotBottom, plotWidth\)/);
  assert.doesNotMatch(chart, /sectionGap|streamTop|streamPlotHeight|onlinePlotHeight/);
  assert.doesNotMatch(chart, /再生数増加\/分（5分平均）|stream_minute_history|コメント\/2分|comment_velocity|commentVelocity|rgba\(22,139,115/);
  assert.match(chart, /時刻（JST）/);
  assert.match(chart, /JST_TIME_HM/);
  assert.match(chart, /drawSeries\(context, current, xFor, yOnline, '#111', 2\)/);
  assert.match(chart, /const EXTREMA_POINT_COLOR = '#888'/);
  assert.match(chart, /if \(minRow\) \{[\s\S]*context\.fillStyle = EXTREMA_POINT_COLOR/);
  assert.match(chart, /if \(maxRow\) \{[\s\S]*context\.fillStyle = EXTREMA_POINT_COLOR/);
  assert.match(chart, /`最小 \$\{integer\.format\(currentMin\)\}（\$\{JST_TIME_HM\.format/);
  assert.match(chart, /`最大 \$\{integer\.format\(currentMax\)\}（\$\{JST_TIME_HM\.format/);
  assert.doesNotMatch(chart, /strokeRect\(/);
});

test('shared Stationhead current shell contains no Buddies-only goal card', () => {
  assert.doesNotMatch(sharedShell, /metricGoalCompact|streamGoal|goalEta|goal-card|streamCount|goalBar|goalPercent|goalRemaining|goalRate|goalMilestones/);
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
