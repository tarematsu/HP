import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backfillQqJapanHistory,
  compareQqJapanHistoryPeriods,
  filterQqJapanSakamichiEntries,
  QQ_JAPAN_HISTORY_INDEX_KEY,
  QQ_JAPAN_HISTORY_PROGRESS_KEY,
  qqIsoWeekPeriod,
  qqJapanHistoryPeriods,
  qqJapanHistoryR2Key,
  qqJapanHistoryToplistUrl,
} from '../scripts/backfill-qq-japan-toplist-history-actions.mjs';

test('QQ Japan history builds ISO weekly periods back to the requested start date', () => {
  assert.equal(qqIsoWeekPeriod(new Date('2026-10-01T00:00:00Z')), '2026_40');
  assert.equal(qqIsoWeekPeriod(new Date('2024-12-30T00:00:00Z')), '2025_1');
  const periods = qqJapanHistoryPeriods(Date.parse('2026-10-02T00:00:00Z'), '2026-09-20');
  assert.deepEqual(periods.slice(0, 2), ['2026_40', '2026_39']);
});

test('QQ Japan history period ordering compares year and week numerically', () => {
  const periods = ['2026_9', '2026_40', '2025_52', '2018_1'];
  assert.deepEqual(periods.sort(compareQqJapanHistoryPeriods), ['2018_1', '2025_52', '2026_9', '2026_40']);
});

test('QQ Japan historical request sends topId 17, period and Top 100 size', () => {
  const url = new URL(qqJapanHistoryToplistUrl('2025_44'));
  const data = JSON.parse(url.searchParams.get('data'));
  assert.equal(data.req_1.module, 'musicToplist.ToplistInfoServer');
  assert.equal(data.req_1.method, 'GetDetail');
  assert.equal(data.req_1.param.topId, 17);
  assert.equal(data.req_1.param.period, '2025_44');
  assert.equal(data.req_1.param.num, 100);
});

test('QQ Japan history keeps only Nogizaka, Sakurazaka and Hinatazaka rows', () => {
  const entries = filterQqJapanSakamichiEntries([
    {position:1,track_id:'s',title:'S',album_name:'A',canonical_artist:'sakurazaka46',artists:[{mid:'1',name:'櫻坂46'}]},
    {position:2,track_id:'n',title:'N',album_name:'B',canonical_artist:'nogizaka46',artists:[{mid:'2',name:'乃木坂46'}]},
    {position:3,track_id:'h',title:'H',album_name:'C',canonical_artist:'hinatazaka46',artists:[{mid:'3',name:'日向坂46'}]},
    {position:4,track_id:'x',title:'X',album_name:'D',canonical_artist:null,artists:[{mid:'4',name:'Other'}]},
  ]);
  assert.deepEqual(entries.map((row) => row.canonical_artist), ['sakurazaka46','nogizaka46','hinatazaka46']);
});

test('QQ Japan backfill writes resumable per-week R2 records and an index', async () => {
  const objects = new Map();
  const saved = [];
  const charts = new Map([
    ['2026_40', {
      requested_period:'2026_40', provider_period:'2026_40', update_time:'2026-10-01', fingerprint:'a',
      entries:[
        {position:9,track_id:'s',title:'Sakura',album_name:'A',canonical_artist:'sakurazaka46',artists:[{mid:'s1',name:'櫻坂46'}]},
        {position:20,track_id:'x',title:'Other',album_name:'B',canonical_artist:null,artists:[{mid:'x1',name:'Other'}]},
      ],
    }],
    ['2026_39', {
      requested_period:'2026_39', provider_period:'2026_39', update_time:'2026-09-24', fingerprint:'b',
      entries:[
        {position:44,track_id:'n',title:'Nogi',album_name:'C',canonical_artist:'nogizaka46',artists:[{mid:'n1',name:'乃木坂46'}]},
        {position:81,track_id:'h',title:'Hina',album_name:'D',canonical_artist:'hinatazaka46',artists:[{mid:'h1',name:'日向坂46'}]},
      ],
    }],
  ]);
  const load = async (key) => structuredClone(objects.get(key) ?? null);
  const save = async (key, value) => {
    objects.set(key, structuredClone(value));
    saved.push(key);
  };
  const result = await backfillQqJapanHistory({
    load,
    save,
    periods:['2026_40','2026_39'],
    fetchPeriod:async (period) => structuredClone(charts.get(period)),
    now:Date.parse('2026-10-02T00:00:00Z'),
    sleep:async () => {},
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.fetched, 2);
  assert.equal(result.failures, 0);
  assert.equal(objects.get(qqJapanHistoryR2Key('2026_40')).entries.length, 1);
  assert.deepEqual(
    objects.get(qqJapanHistoryR2Key('2026_39')).entries.map((row) => row.canonical_artist),
    ['nogizaka46','hinatazaka46'],
  );
  assert.equal(objects.get(QQ_JAPAN_HISTORY_INDEX_KEY).weeks['2026_40'].counts.sakurazaka46, 1);
  assert.equal(objects.get(QQ_JAPAN_HISTORY_PROGRESS_KEY).stored_periods, 2);
  assert.equal(objects.get(QQ_JAPAN_HISTORY_INDEX_KEY).latest_period, '2026_40');
  assert.ok(saved.includes(QQ_JAPAN_HISTORY_INDEX_KEY));
});

test('QQ Japan backfill skips already stored weeks without refetching', async () => {
  const existing = {
    version:1,service:'qq_music',chart:'japan_toplist',top_id:17,period:'2026_40',provider_period:'2026_40',
    update_time:'2026-10-01',collected_at:1,source_url:'https://y.qq.com/n/ryqq/toplist/17',
    counts:{sakurazaka46:0,nogizaka46:0,hinatazaka46:0},entries:[],
  };
  const objects = new Map([[qqJapanHistoryR2Key('2026_40'), existing]]);
  let fetched = 0;
  const result = await backfillQqJapanHistory({
    load:async (key) => structuredClone(objects.get(key) ?? null),
    save:async (key,value) => objects.set(key,structuredClone(value)),
    periods:['2026_40'],
    fetchPeriod:async () => { fetched += 1; throw new Error('must not fetch'); },
    sleep:async () => {},
  });
  assert.equal(fetched, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.stored_periods, 1);
});
