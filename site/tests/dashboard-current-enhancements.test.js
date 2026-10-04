import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const sharedShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const stationheadRuntime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fetchCache = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-current-enhancements.css', import.meta.url), 'utf8');
const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');

test('current Stationhead renderer and markup are shared instead of Buddies-specific', () => {
  assert.match(readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8'), /stationhead-channel\.js\?v=/);
  assert.match(readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8'), /async function showCurrent\(/);
  assert.match(readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8'), /import \{ fetchDashboard \}/);
  assert.match(currentShell, /mountStationheadChannelShell/);
  assert.match(currentShell, /stationheadModel = 'buddies'/);
  assert.match(sharedShell, /metric\('オンライン', 'online', true\)/);
  assert.match(sharedShell, /metric\('総再生数', 'streams'\)/);
  assert.match(sharedShell, /metric\('総メンバー数', 'members'\)/);
  assert.ok(sharedShell.indexOf("metric('オンライン', 'online', true)") < sharedShell.indexOf("metric('総再生数', 'streams')"));
  assert.ok(sharedShell.indexOf("metric('総再生数', 'streams')") < sharedShell.indexOf("metric('総メンバー数', 'members')"));
  assert.match(stationheadRuntime, /function renderCurrent\(/);
  assert.match(stationheadRuntime, /function renderCurrentChart\(/);
  assert.doesNotMatch(metrics, /dashboard-current-layout\.js|dashboard-chart-stability\.js|dashboard-chart-comparison\.js|dashboard-chart-detail\.js|dashboard-daily-summaries\.js|dashboard-client\.js/);
  assert.doesNotMatch(header, /\.css\?v=|createElement\('link'\)/);
  assert.doesNotMatch(metrics, /window\.fetch|response\.clone\(\)\.json|restoreDashboardCache/);
  assert.match(fetchCache, /dashboard:payload/);
  assert.doesNotMatch(stationheadRuntime, /ensureMetricLayout|enforceStationheadLink|drawEnhancedChart/);
});

test('shared mobile layout owns tab count and current metric columns', () => {
  assert.match(sharedLayout, /\.metrics\s*\{[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(sharedLayout, /#currentView/);
});

test('shared current chart overlays direct five-minute playback bars on the online plot', () => {
  assert.match(stationheadRuntime, /payload\?\.history_24h/);
  assert.match(stationheadRuntime, /stream_delta_5m/);
  assert.match(stationheadRuntime, /context\.fillRect\(/);
  assert.match(stationheadRuntime, /drawOnlineSeries\(context, rows, x, y, '#111', 2\)/);
  assert.match(stationheadRuntime, /再生数増加/);
  assert.doesNotMatch(stationheadRuntime, /comment_velocity|commentVelocity|コメント\/2分/);
});

test('shared Stationhead current shell contains no Buddies-only goal card', () => {
  assert.doesNotMatch(sharedShell, /metricGoalCompact|streamGoal|goalEta|goal-card|streamCount|goalBar|goalPercent|goalRemaining|goalRate|goalMilestones/);
  assert.doesNotMatch(css, /\.goal-card/);
});

test('dashboard deltas are green and refresh label is not ellipsized', () => {
  assert.match(css, /\.metrics \.delta,[\s\S]*color:\s*#168b73/);
  assert.match(css, /#updated[\s\S]*text-overflow:\s*clip/);
  assert.match(css, /#updated[\s\S]*white-space:\s*normal/);
});

test('history summary keeps total sample count and never renders listener-valid sample count', () => {
  assert.match(history, /\['sample_count', '取得記録数', 'その期間に保存された全サンプル数'\]/);
  assert.doesNotMatch(history, /\['reliable_sample_count'|有効記録数|同接有効数/);
});
