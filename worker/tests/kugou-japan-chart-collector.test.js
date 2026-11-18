import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KUGOU_JAPAN_CHART_HISTORY_VIEW_KEY,
  collectLatestKugouJapanHistory,
  kugouJapanSongsUrl,
  kugouJapanVolumeList,
  kugouJapanVolumeUrl,
  parseKugouJapanSongs,
} from '../src/kugou-japan-chart-collector.js';

const volumePayload = (date = '20261113', volid = '126999') => ({
  status:1,
  errcode:0,
  data:{ info:[{ year:2026, vols:[{ volid, volname:date, voltitle:date, issue:227 }] }] },
});

const songsPayload = {
  status:1,
  errcode:0,
  data:{ info:[
    { filename:'乃木坂46 - 君ロス', album_audio_id:101 },
    { filename:'櫻坂46 - 愛 MUST BE', album_audio_id:102 },
    { singername:'日向坂46', songname:'ありがとう', audio_id:103 },
    { filename:'Other Artist - Other Song', album_audio_id:104 },
    { filename:'乃木坂46 - Duplicate entry', album_audio_id:101 },
  ] },
};

function response(payload) {
  return new Response(
    `<!--KG_TAG_RES_START-->${JSON.stringify(payload)}<!--KG_TAG_RES_END-->`,
    { status:200, headers:{ 'content-type':'text/plain' } },
  );
}

test('Kugou Japan chart endpoints use the weekday Japan new-song rank', () => {
  const volumeUrl = new URL(kugouJapanVolumeUrl());
  const songsUrl = new URL(kugouJapanSongsUrl('126999'));
  assert.equal(volumeUrl.searchParams.get('rankid'), '31312');
  assert.equal(volumeUrl.searchParams.get('ranktype'), '1');
  assert.equal(songsUrl.searchParams.get('rankid'), '31312');
  assert.equal(songsUrl.searchParams.get('volid'), '126999');
  assert.equal(songsUrl.searchParams.get('pagesize'), '100');
});

test('Kugou Japan volume list keeps date-based daily issues in descending order', () => {
  const volumes = kugouJapanVolumeList({
    data:{ info:[{ year:2026, vols:[
      { volid:100, volname:'20261112' },
      { volid:101, volname:'20261113' },
      { volid:99, volname:'not-a-date' },
    ] }] },
  });
  assert.deepEqual(volumes.map((item) => [item.period, item.volid]), [
    ['2026-11-13', '101'],
    ['2026-11-12', '100'],
  ]);
});

test('Kugou Japan song parser maps only the three target groups and removes duplicate track IDs', () => {
  const rows = parseKugouJapanSongs(songsPayload);
  assert.deepEqual(rows.map((row) => [row.position, row.canonical_artist, row.track_id, row.title]), [
    [1, 'nogizaka46', '101', '君ロス'],
    [2, 'sakurazaka46', '102', '愛 MUST BE'],
    [3, 'hinatazaka46', '103', 'ありがとう'],
  ]);
});

test('Kugou Japan collector writes one compact view only when a newer provider volume exists', async () => {
  const saved = new Map();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return response(url.includes('/rank/vol?') ? volumePayload() : songsPayload);
  };
  const result = await collectLatestKugouJapanHistory({
    load:async (key) => saved.get(key) ?? null,
    save:async (key, value) => saved.set(key, structuredClone(value)),
    fetchImpl,
    now:Date.parse('2026-11-18T02:30:00Z'),
  });

  assert.equal(calls.length, 2);
  assert.equal(result.changed, true);
  assert.equal(result.period, '2026-11-13');
  assert.equal(result.source_rows, 5);
  assert.equal(result.entries, 3);
  const view = saved.get(KUGOU_JAPAN_CHART_HISTORY_VIEW_KEY);
  assert.equal(view.coverage.latest_available, '2026-11-13');
  assert.equal(view.coverage.latest_checked, '2026-11-14');
  assert.equal(view.history.length, 3);
  assert.equal(view.history[0].rank, 1);
});

test('Kugou Japan collector skips a stored volume without fetching songs or writing R2', async () => {
  let calls = 0;
  const result = await collectLatestKugouJapanHistory({
    load:async () => ({
      latest_volid:'126999',
      coverage:{ latest_available:'2026-11-13' },
      history:[],
    }),
    save:async () => { throw new Error('must not write unchanged volume'); },
    fetchImpl:async () => {
      calls += 1;
      return response(volumePayload());
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.changed, false);
  assert.equal(result.period, '2026-11-13');
});

test('Kugou Japan collector does not overwrite a newer stored period after provider regression', async () => {
  let writes = 0;
  const result = await collectLatestKugouJapanHistory({
    load:async () => ({
      latest_volid:'126999',
      coverage:{ latest_available:'2026-11-13' },
      history:[],
    }),
    save:async () => { writes += 1; },
    fetchImpl:async () => response(volumePayload('20261112', '126998')),
  });
  assert.equal(result.changed, false);
  assert.equal(result.stale, true);
  assert.equal(result.stored_period, '2026-11-13');
  assert.equal(writes, 0);
});
