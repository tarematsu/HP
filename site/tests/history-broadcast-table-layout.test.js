import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const table = readFileSync(new URL('../public/history/history-broadcast-table.js', import.meta.url), 'utf8');
const partyUi = readFileSync(new URL('../public/official-listening-party-ui.js', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const historyApi = readFileSync(new URL('../functions/api/history.js', import.meta.url), 'utf8');

test('official listening party table uses the shared read-model column contract', () => {
  assert.match(entry, /history-broadcast-table\.js\?v=20261001\.1/);
  for (const label of [
    '日付', '時間帯', '所要時間', '平均同接', '最小同接', '最大同接',
    '楽曲数', '推定再生数', '放送内容', 'イベント名', '出典',
  ]) {
    assert.match(partyUi, new RegExp(label));
  }
  assert.match(table, /official-listening-party-ui\.js\?v=20261001\.1/);
  assert.match(table, /createOfficialPartyHeaderRow\(\{ layoutMarker: true \}\)/);
  assert.match(table, /createOfficialPartyDataRow\(values, row\?\.source_url\)/);
  assert.match(table, /officialPartyNumberText\(average, decimal\)/);
  assert.match(table, /splitOfficialEventName\(row\?\.event_name/);
  assert.match(table, /durationLabel\(durationMinutes\(row\)\)/);
  assert.match(table, /row\?\.estimated_streams/);
  assert.match(table, /row\?\.broadcast_content/);
  assert.doesNotMatch(table, /DATE_PREFIX|function numberText|function createCell|function elapsedLabel|function splitEvent|createOfficialSourceCell|コメント数|comment_count/);
});

test('official listening party source URLs are owned by the server read model and shared row renderer', () => {
  for (const id of ['M01328', 'M01519', 'M01523', 'M01667', 'M01853', 'R00518', 'R00621']) {
    assert.match(historyApi, new RegExp(`https://sakurazaka46\\.com/s/s46/news/detail/${id}`));
  }
  assert.match(table, /createOfficialPartyDataRow\(values, row\?\.source_url\)/);
  assert.match(partyUi, /createOfficialSourceCell\(sourceUrl/);
  assert.match(partyUi, /link\.textContent = label/);
  assert.match(partyUi, /link\.target = '_blank'/);
  assert.match(partyUi, /link\.rel = 'noopener noreferrer'/);
});

test('official listening party table has no hidden compatibility columns or enrichment pass', () => {
  assert.doesNotMatch(table, /TECHNICAL_HEADERS|開始日時（UTC）|nth-child\(n\+11\)/);
  assert.doesNotMatch(table, /getElementById\('more'\)|setTimeout\(\(\) => render/);
  assert.doesNotMatch(table, /createElement\('style'\)/);
  assert.match(table, /dataset\.officialPartyReadModel = 'complete'/);
});

test('official listening party table left-aligns content columns through shared CSS', () => {
  assert.match(sharedCss, /official-party-table :is\(th, td\):nth-child\(n \+ 10\)/);
  assert.match(sharedCss, /text-align: left/);
});

test('official listening party table layout does not rewrite the graph legend', () => {
  assert.doesNotMatch(table, /chartLegend/);
});
