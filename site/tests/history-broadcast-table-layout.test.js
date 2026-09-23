import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const table = readFileSync(new URL('../public/history/history-broadcast-table.js', import.meta.url), 'utf8');

test('official listening party table uses the requested column order with source at the right edge', () => {
  assert.match(entry, /history-broadcast-table\.js\?v=20260923\.5/);
  assert.match(table, /VISIBLE_HEADERS = \['日付', '時間', '長さ', '平均同接', '最大同接', '曲数', '推定再生数', '放送内容', '名前', '出典'\]/);
  assert.match(table, /DATE_PREFIX/);
  assert.match(table, /raw\.slice\(match\[0\]\.length\)\.trim\(\)/);
  assert.match(table, /broadcastTimeLabel\(row\)/);
  assert.match(table, /`\$\{start\}-\$\{end\}`/);
  assert.match(table, /elapsedLabel\(durationMinutes\(row\)\)/);
  assert.match(table, /Math\.round\(average \* tracks\)/);
  assert.match(table, /row\?\.broadcast_content/);
});

test('official listening party table links every known event to Sakurazaka46 official news', () => {
  for (const id of ['M01328', 'M01519', 'M01523', 'M01667', 'M01853', 'R00518', 'R00621']) {
    assert.match(table, new RegExp(`https://sakurazaka46\\.com/s/s46/news/detail/${id}`));
  }
  assert.match(table, /link\.textContent = '公式告知'/);
  assert.match(table, /link\.target = '_blank'/);
  assert.match(table, /link\.rel = 'noopener noreferrer'/);
});

test('official listening party table preserves hidden compatibility columns for metric enrichment', () => {
  assert.match(table, /official-party-table th:nth-child\(n\+11\)/);
  assert.match(table, /official-party-table td:nth-child\(n\+11\)/);
});

test('official listening party table left-aligns broadcast content, name and source', () => {
  assert.match(table, /official-party-table th:nth-child\(8\)/);
  assert.match(table, /official-party-table td:nth-child\(8\)/);
  assert.match(table, /official-party-table th:nth-child\(9\)/);
  assert.match(table, /official-party-table td:nth-child\(9\)/);
  assert.match(table, /official-party-table th:nth-child\(10\)/);
  assert.match(table, /official-party-table td:nth-child\(10\)/);
  assert.match(table, /text-align: left !important/);
});

test('official listening party table layout does not rewrite the graph legend', () => {
  assert.doesNotMatch(table, /chartLegend/);
});
