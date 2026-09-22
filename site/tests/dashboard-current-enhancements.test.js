import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const enhancement = readFileSync(new URL('../public/dashboard-current-enhancements.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-current-enhancements.css', import.meta.url), 'utf8');
const tableCleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');

test('current metrics are ordered online, total streams and total members without a 24h online range', () => {
  assert.match(metrics, /dashboard-current-enhancements\.js\?v=20260921\.4/);
  assert.match(metrics, /dashboard-client\.js\?v=[^']+/);
  assert.match(header, /dashboard-current-enhancements\.css\?v=20260921\.4/);
  assert.match(metrics, /dashboard:payload/);
  assert.match(enhancement, /\[onlinePanel, streamsPanel, membersPanel\]/);
  assert.doesNotMatch(enhancement, /24h最小/);
  assert.doesNotMatch(enhancement, /24h最大/);
  assert.doesNotMatch(enhancement, /renderOnlineRange/);
});

test('mobile dashboard tabs and metrics stay compact', () => {
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs/);
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /grid-template-rows:\s*repeat\(2, minmax\(32px, auto\)\) !important/);
  assert.match(css, /\.metrics\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /white-space:\s*nowrap !important/);
});

test('current chart draws numeric axes in black and green with JST labels', () => {
  assert.match(enhancement, /オンライン数\(人\)/);
  assert.match(enhancement, /コメント\/2分/);
  assert.match(enhancement, /時刻 \(JST\)/);
  assert.match(enhancement, /timeZone: 'Asia\/Tokyo'/);
  assert.match(enhancement, /strokeStyle = '#111'/);
  assert.match(enhancement, /rgba\(22,139,115,\.32\)/);
  assert.match(enhancement, /`最小 \$\{numberText\(onlineRawMin\)\}（\$\{jstExtremaTime\.format/);
  assert.match(enhancement, /`最大 \$\{numberText\(onlineRawMax\)\}（\$\{jstExtremaTime\.format/);
  assert.doesNotMatch(enhancement, /strokeRect\(/);
});

test('stream goal is moved into the metric and ETA is display-only JST', () => {
  assert.match(enhancement, /metricGoalCompact/);
  assert.match(enhancement, /jstGoalDateTime = new Intl\.DateTimeFormat[\s\S]*timeZone: 'Asia\/Tokyo'/);
  assert.match(enhancement, /jstGoalDateTime\.format/);
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
