import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const table = readFileSync(new URL('../public/history/history-broadcast-table.js', import.meta.url), 'utf8');

test('official listening party table uses the compact requested column order', () => {
  assert.match(entry, /history-broadcast-table\.js\?v=20260923\.1/);
  assert.match(table, /VISIBLE_HEADERS = \['日付', '名前', '平均同接', '最大同接', '曲数', '時間'\]/);
  assert.match(table, /DATE_PREFIX/);
  assert.match(table, /raw\.slice\(match\[0\]\.length\)\.trim\(\)/);
  assert.match(table, /elapsedLabel\(durationMinutes\(row\)\)/);
});

test('official listening party table preserves hidden compatibility columns for metric enrichment', () => {
  assert.match(table, /TECHNICAL_HEADERS = \['放送名', '開始日時（UTC）', '最小同接', '推定再生数', 'コメント数'\]/);
  assert.match(table, /official-party-table th:nth-child\(n\+7\)/);
  assert.match(table, /official-party-table td:nth-child\(n\+7\)/);
});

test('official listening party table layout does not rewrite the graph legend', () => {
  assert.doesNotMatch(table, /chartLegend/);
});
