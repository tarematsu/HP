import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const table = readFileSync(new URL('../public/history/history-broadcast-table.js', import.meta.url), 'utf8');
const historyApi = readFileSync(new URL('../functions/api/history.js', import.meta.url), 'utf8');

test('official listening party table uses clear read-model column labels with source at the right edge', () => {
  assert.match(entry, /history-broadcast-table\.js\?v=20260924\.1/);
  for (const label of [
    '日付', '時間帯', '所要時間', '平均同接', '最小同接', '最大同接',
    '楽曲数', '推定再生数', 'コメント数', '放送内容', 'イベント名', '出典',
  ]) {
    assert.match(table, new RegExp(label));
  }
  assert.match(table, /DATE_PREFIX/);
  assert.match(table, /raw\.slice\(match\[0\]\.length\)\.trim\(\)/);
  assert.match(table, /broadcastTimeLabel\(row\)/);
  assert.match(table, /elapsedLabel\(durationMinutes\(row\)\)/);
  assert.match(table, /row\?\.estimated_streams/);
  assert.match(table, /row\?\.broadcast_content/);
});

test('official listening party source URLs are owned by the server read model', () => {
  for (const id of ['M01328', 'M01519', 'M01523', 'M01667', 'M01853', 'R00518', 'R00621']) {
    assert.match(historyApi, new RegExp(`https://sakurazaka46\\.com/s/s46/news/detail/${id}`));
  }
  assert.match(table, /createSourceCell\(row\?\.source_url\)/);
  assert.match(table, /link\.textContent = '公式告知'/);
  assert.match(table, /link\.target = '_blank'/);
  assert.match(table, /link\.rel = 'noopener noreferrer'/);
});

test('official listening party table has no hidden compatibility columns or enrichment pass', () => {
  assert.doesNotMatch(table, /TECHNICAL_HEADERS|開始日時（UTC）|nth-child\(n\+11\)/);
  assert.doesNotMatch(table, /getElementById\('more'\)|setTimeout\(\(\) => render/);
  assert.match(table, /dataset\.officialPartyReadModel = 'complete'/);
});

test('official listening party table left-aligns broadcast content, event name and source', () => {
  for (const column of [10, 11, 12]) {
    assert.match(table, new RegExp(`official-party-table th:nth-child\\(${column}\\)`));
    assert.match(table, new RegExp(`official-party-table td:nth-child\\(${column}\\)`));
  }
  assert.match(table, /text-align: left !important/);
});

test('official listening party table layout does not rewrite the graph legend', () => {
  assert.doesNotMatch(table, /chartLegend/);
});
