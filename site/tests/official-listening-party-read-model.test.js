import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const historyApi = readFileSync(new URL('../functions/api/history.js', import.meta.url), 'utf8');
const historyMain = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const table = readFileSync(new URL('../public/history/history-broadcast-table.js', import.meta.url), 'utf8');
const chart = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');

test('official listening-party API returns a complete server-side read model', () => {
  assert.match(historyApi, /BROADCAST_READ_MODEL_SQL/);
  assert.match(historyApi, /sh_host_broadcast_sessions/);
  assert.match(historyApi, /sh_host_station_snapshots/);
  assert.match(historyApi, /listener_min/);
  assert.match(historyApi, /comment_count/);
  assert.match(historyApi, /estimated_streams/);
  assert.match(historyApi, /source_url/);
  assert.match(historyApi, /read_model_complete: loaded\.complete/);
  assert.match(historyApi, /official-listening-parties:v1/);
});

test('official listening-party table renders final fields directly without hidden enrichment columns', () => {
  for (const field of ['listener_avg', 'listener_min', 'listener_max', 'distinct_tracks', 'estimated_streams', 'comment_count', 'source_url']) {
    assert.match(table, new RegExp(field));
  }
  for (const label of ['平均同接', '最小同接', '最大同接', '曲数', '推定再生数', 'コメント数', '放送内容', '名前', '出典']) {
    assert.match(table, new RegExp(label));
  }
  assert.doesNotMatch(table, /TECHNICAL_HEADERS|OFFICIAL_NEWS|開始日時（UTC）/);
  assert.doesNotMatch(table, /setTimeout\(\(\) => render|more'\)\?\.addEventListener/);
});

test('official listening-party chart no longer fetches or mutates table enrichment data', () => {
  assert.doesNotMatch(chart, /host-history|TABLE_METRICS|enhanceBroadcastTable|loadHostSessions|scheduleTableEnhance/);
  assert.doesNotMatch(chart, /getElementById\('thead'\)|getElementById\('tbody'\)/);
  assert.match(chart, /fetch\(`\/api\/sakurazaka46jp\?/);
});

test('broadcast runtime cache keys point at the consolidated clients', () => {
  assert.match(historyMain, /history-broadcasts\.js\?v=20260923\.4/);
  assert.match(historyMain, /history-broadcast-table\.js\?v=20260923\.6/);
});
