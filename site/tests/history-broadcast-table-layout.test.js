import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const table = readFileSync(new URL('../public/history/history-broadcast-table.js', import.meta.url), 'utf8');

test('official listening party table uses the compact requested column order', () => {
  assert.match(entry, /history-broadcast-table\.js\?v=20260923\.4/);
  assert.match(table, /VISIBLE_HEADERS = \['日付', '時間', '長さ', '平均同接', '最大同接', '曲数', '推定再生数', '放送内容', '名前'\]/);
  assert.match(table, /DATE_PREFIX/);
  assert.match(table, /raw\.slice\(match\[0\]\.length\)\.trim\(\)/);
  assert.match(table, /broadcastTimeLabel\(row\)/);
  assert.match(table, /`\$\{start\}-\$\{end\}`/);
  assert.match(table, /elapsedLabel\(durationMinutes\(row\)\)/);
  assert.match(table, /Math\.round\(average \* tracks\)/);
  assert.match(table, /row\?\.broadcast_content/);
});

test('official listening party table preserves hidden compatibility columns for metric enrichment', () => {
  assert.match(table, /official-party-table th:nth-child\(n\+10\)/);
  assert.match(table, /official-party-table td:nth-child\(n\+10\)/);
});

test('official listening party table left-aligns broadcast content and name', () => {
  assert.match(table, /official-party-table th:nth-child\(8\)/);
  assert.match(table, /official-party-table td:nth-child\(8\)/);
  assert.match(table, /official-party-table th:nth-child\(9\)/);
  assert.match(table, /official-party-table td:nth-child\(9\)/);
  assert.match(table, /text-align: left !important/);
});

test('official listening party table layout does not rewrite the graph legend', () => {
  assert.doesNotMatch(table, /chartLegend/);
});
