import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const enhancement = readFileSync(new URL('../public/dashboard-current-enhancements.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-current-enhancements.css', import.meta.url), 'utf8');
const tableCleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');

test('current metrics are ordered online, total streams, total members and expose 24h online range', () => {
  assert.match(metrics, /dashboard-current-enhancements\.js\?v=20260921\.4/);
  assert.match(metrics, /dashboard-client\.js\?v=20260921\.4/);
  assert.match(header, /dashboard-current-enhancements\.css\?v=20260921\.4/);
  assert.match(metrics, /dashboard:payload/);
  assert.match(enhancement, /\[onlinePanel, streamsPanel, membersPanel\]/);
  assert.match(enhancement, /24h最小/);
  assert.match(enhancement, /24h最大/);
});

test('mobile dashboard tabs are forced into four columns and two rows', () => {
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs/);
  assert.match(css, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /grid-template-rows:\s*repeat\(2, minmax\(32px, auto\)\) !important/);
  assert.match(css, /white-space:\s*nowrap !important/);
});

test('current chart draws numeric axes and labels online minimum and maximum', () => {
  assert.match(enhancement, /オンライン\(人\)/);
  assert.match(enhancement, /コメント\/2分/);
  assert.match(enhancement, /時刻 \(UTC\)/);
  assert.match(enhancement, /`最小 \$\{numberText\(onlineRawMin\)\}`/);
  assert.match(enhancement, /`最大 \$\{numberText\(onlineRawMax\)\}`/);
});

test('dashboard deltas are green and refresh label is not ellipsized', () => {
  assert.match(css, /\.metrics \.delta,[\s\S]*color:\s*#168b73 !important/);
  assert.match(css, /#updated[\s\S]*text-overflow:\s*clip !important/);
  assert.match(css, /#updated[\s\S]*white-space:\s*normal !important/);
});

test('history summary sample labels explain total samples versus listener-bearing samples', () => {
  assert.match(tableCleanup, /\['記録数', \['取得記録数', 'その期間に保存された全サンプル数'\]\]/);
  assert.match(tableCleanup, /\['有効記録数', \['同接有効数', 'オンライン人数が取得できたサンプル数'\]\]/);
});
