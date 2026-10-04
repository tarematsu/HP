import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KUGOU_ACG_HISTORY_INDEX_KEY,
  KUGOU_ACG_HISTORY_VIEW_KEY,
  collectLatestKugouAcgHistory,
  kugouAcgHistoryRecord,
  kugouAcgHistoryR2Key,
  kugouAcgSongsUrl,
  kugouAcgVolumeList,
  kugouAcgVolumeUrl,
  parseKugouAcgSongs,
  parseKugouApiJson,
  upsertKugouAcgHistoryArtifacts,
} from '../src/kugou-acg-chart-history.js';

test('Kugou ACG rank endpoints use the provider-supported HTTP host', () => {
  assert.match(kugouAcgVolumeUrl(), /^http:\/\/mobilecdnbj\.kugou\.com\/api\/v3\/rank\/vol\?/);
  assert.match(kugouAcgSongsUrl('126794'), /^http:\/\/mobilecdnbj\.kugou\.com\/api\/v3\/rank\/song\?/);
  assert.equal(new URL(kugouAcgSongsUrl('126794')).searchParams.get('volid'), '126794');
});

test('Kugou API parser unwraps KG_TAG JSON envelopes', () => {
  const payload = parseKugouApiJson(
    '<!--KG_TAG_RES_START-->{"status":1,"errcode":0,"data":{"info":[]}}<!--KG_TAG_RES_END-->',
  );
  assert.equal(payload.status, 1);
  assert.equal(payload.errcode, 0);
  assert.deepEqual(payload.data.info, []);
});

test('Kugou ACG volume list derives ISO week from date-form volume names', () => {
  const volumes = kugouAcgVolumeList({
    data:{ info:[{ year:2026, vols:[{ volid:126794, volname:'20261001', voltitle:'20261001' }] }] },
  });
  assert.equal(volumes.length,1);
  assert.equal(volumes[0].period,'2026_40');
  assert.equal(volumes[0].published_at,'2026-10-01');
  assert.equal(volumes[0].volid,'126794');
});

test('Kugou ACG volume list supports legacy issue-form volumes', () => {
  const volumes = kugouAcgVolumeList({
    data:{ info:[{ year:2025, vols:[{ volid:111, volname:'15期' }] }] },
  });
  assert.equal(volumes.length,1);
  assert.equal(volumes[0].period,'2025_15');
  assert.equal(volumes[0].issue,15);
  assert.match(volumes[0].published_at,/^2025-04-/);
});

test('Kugou ACG song parser keeps only Sakamichi rows with provider rank', () => {
  const rows = parseKugouAcgSongs({
    data:{ info:[
      { filename:'櫻坂46 - ピッカーン！', album_audio_id:101 },
      { filename:'乃木坂46 - あの光', album_audio_id:102 },
      { filename:'日向坂46 - テスト', album_audio_id:103 },
      { filename:'Other Artist - Other Song', album_audio_id:104 },
    ] },
  });
  assert.deepEqual(rows.map((row) => [row.position,row.canonical_artist,row.track_id,row.title]), [
    [1,'sakurazaka46','101','ピッカーン！'],
    [2,'nogizaka46','102','あの光'],
    [3,'hinatazaka46','103','テスト'],
  ]);
});

test('Kugou ACG song parser recognizes Sakamichi anime collaborations without group-name credit', () => {
  const rows = parseKugouAcgSongs({
    data:{ info:[
      {
        authors:[{author_name:'ギガP'},{author_name:'TeddyLoid'},{author_name:'松田里奈'},{author_name:'森田ひかる'}],
        songname:'ピッカーン！ (皮卡！)', album_audio_id:201,
      },
      { singername:'ぼっちぼろまる、正源司陽子', songname:'ロマンティックがほしいなら', album_audio_id:202 },
      { singername:'Unknown', songname:'What’s “KAZOKU”?', album_audio_id:203 },
      { singername:'Unknown', songname:'月の大きさ (月亮的大小)', album_audio_id:204 },
      { singername:'Unknown', songname:'1・2・3 (一二三)', album_audio_id:205 },
      { singername:'Unknown', songname:'Unrelated anime song', album_audio_id:206 },
    ] },
  });
  assert.deepEqual(rows.map((row) => [row.position,row.canonical_artist,row.track_id,row.title]), [
    [1,'sakurazaka46','201','ピッカーン！ (皮卡！)'],
    [2,'hinatazaka46','202','ロマンティックがほしいなら'],
    [3,'sakurazaka46','203','What’s “KAZOKU”?'],
    [4,'nogizaka46','204','月の大きさ (月亮的大小)'],
    [5,'nogizaka46','205','1・2・3 (一二三)'],
  ]);
});

test('Kugou ACG history upsert writes week, index and compact view', async () => {
  const store = new Map();
  const load = async (key) => structuredClone(store.get(key) ?? null);
  const save = async (key,value) => store.set(key,structuredClone(value));
  const record = kugouAcgHistoryRecord({
    period:'2025_10', published_at:'2025-03-06', issue:10, volid:'1000',
  }, [{
    position:35, canonical_artist:'sakurazaka46', track_id:'p', title:'ピッカーン！', filename:'櫻坂46 - ピッカーン！', hash:null,
  }], 123);

  const result = await upsertKugouAcgHistoryArtifacts({load,save,record,updatedAt:456});
  assert.ok(store.has(kugouAcgHistoryR2Key('2025_10')));
  assert.ok(store.has(KUGOU_ACG_HISTORY_INDEX_KEY));
  assert.ok(store.has(KUGOU_ACG_HISTORY_VIEW_KEY));
  assert.equal(result.index.weeks['2025_10'].entries,1);
  assert.equal(result.view.history.length,1);
  assert.equal(result.view.history[0].rank,35);
});

test('Kugou ACG latest collection skips song fetch when the volume is already stored', async () => {
  let calls = 0;
  const index = { version:1, weeks:{ '2026_40':{ period:'2026_40', volid:'126794', entries:0 } } };
  const result = await collectLatestKugouAcgHistory({
    load:async (key) => key === KUGOU_ACG_HISTORY_INDEX_KEY ? index : null,
    save:async () => { throw new Error('must not save unchanged volume'); },
    fetchImpl:async () => {
      calls += 1;
      return {
        ok:true,
        async json() {
          return { status:1, errcode:0, data:{ info:[{ year:2026, vols:[{ volid:126794, volname:'20261001' }] }] } };
        },
      };
    },
  });
  assert.equal(calls,1);
  assert.equal(result.changed,false);
  assert.equal(result.period,'2026_40');
});