import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectQqJapanToplist,
  collectQqMusic,
  parseQqJapanToplist,
  qqJapanToplistUrl,
  QQ_JAPAN_TOPLIST_ID,
  QQ_JAPAN_TOPLIST_LIMIT,
  QQ_JAPAN_TOPLIST_PLAYLIST_ID,
} from '../src/regional-music-qq.js';

function jsonResponse(payload) {
  return { ok:true, status:200, text:async()=>JSON.stringify(payload) };
}

test('QQ Japan toplist request targets topId 17 and asks for the full Top 100', () => {
  const url = new URL(qqJapanToplistUrl());
  const data = JSON.parse(url.searchParams.get('data'));
  assert.equal(data.req_1.module, 'musicToplist.ToplistInfoServer');
  assert.equal(data.req_1.method, 'GetDetail');
  assert.equal(data.req_1.param.topId, QQ_JAPAN_TOPLIST_ID);
  assert.equal(data.req_1.param.num, QQ_JAPAN_TOPLIST_LIMIT);
  assert.equal(QQ_JAPAN_TOPLIST_ID, 17);
  assert.equal(QQ_JAPAN_TOPLIST_LIMIT, 100);
});

test('QQ Japan toplist parser preserves order and matches Sakamichi artists without dropping other songs', () => {
  const parsed = parseQqJapanToplist({ req_1:{ data:{
    title:'日本榜',
    updateTime:'2026-10-01',
    songInfoList:[
      { songInfo:{ mid:'chart-1', title:'One', album:{name:'Album 1'}, singer:[{mid:'sakura',name:'櫻坂46'}] } },
      { songInfo:{ mid:'chart-2', title:'Two', album:{name:'Album 2'}, singer:[{mid:'other',name:'Other Artist'}] } },
    ],
  } } });
  assert.equal(parsed.title, '日本榜');
  assert.equal(parsed.update_time, '2026-10-01');
  assert.deepEqual(parsed.entries.map((row) => [row.track_id,row.position,row.canonical_artist]), [
    ['chart-1',1,'sakurazaka46'],
    ['chart-2',2,null],
  ]);
});

test('QQ Japan toplist collector stores chart tracks and ordered memberships in the R2 snapshot path', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    const data = JSON.parse(url.searchParams.get('data'));
    assert.equal(data.req_1.method, 'GetDetail');
    return jsonResponse({ req_1:{ data:{
      title:'日本榜',
      updateTime:'2026-10-01',
      songInfoList:[
        { songInfo:{ mid:'chart-1', title:'Chart One', album:{name:'A'}, singer:[{mid:'sakura',name:'櫻坂46'}] } },
        { songInfo:{ mid:'chart-2', title:'Chart Two', album:{name:'B'}, singer:[{mid:'other',name:'Other Artist'}] } },
      ],
    } } });
  };

  const writes = [];
  const env = { REGIONAL_MUSIC_SNAPSHOT_STORE:async (field,value) => writes.push({field,value}) };
  const result = await collectQqJapanToplist(env, Date.parse('2026-10-02T15:00:00Z'), fetchImpl);
  assert.equal(result.status, 'ok');
  assert.equal(result.japan_chart_entries, 2);

  const playlist = writes.find((row) => row.field === 'playlists' && row.value.service_playlist_id === QQ_JAPAN_TOPLIST_PLAYLIST_ID)?.value;
  assert.equal(playlist.playlist_name, '日本榜');
  assert.equal(playlist.playlist_type, 'chart');
  assert.equal(playlist.provider_update_time, '2026-10-01');
  const snapshot = writes.find((row) => row.field === 'playlist_snapshots' && row.value.service_playlist_id === QQ_JAPAN_TOPLIST_PLAYLIST_ID)?.value;
  assert.equal(snapshot.item_count, 2);
  assert.deepEqual(writes.filter((row) => row.field === 'playlist_memberships').map((row) => row.value.position), [1,2]);
  const chartTrack = writes.find((row) => row.field === 'tracks' && row.value.service_track_id === 'chart-1')?.value;
  assert.equal(chartTrack.canonical_artist, 'sakurazaka46');
  assert.deepEqual(chartTrack.provider_artists, ['櫻坂46']);
  const unrelatedTrack = writes.find((row) => row.field === 'tracks' && row.value.service_track_id === 'chart-2')?.value;
  assert.equal(Object.hasOwn(unrelatedTrack, 'canonical_artist'), false);
  assert.equal(Object.hasOwn(unrelatedTrack, 'service_artist_id'), false);
});

test('regular QQ catalog collection does not fetch the Japan toplist', async () => {
  const mids = new Map([
    ['櫻坂46','sakura'],
    ['Sakurazaka46','sakura'],
    ['SAKURAZAKA46','sakura'],
    ['日向坂46','hinata'],
    ['Hinatazaka46','hinata'],
    ['HINATAZAKA46','hinata'],
    ['乃木坂46','nogi'],
    ['Nogizaka46','nogi'],
    ['NOGIZAKA46','nogi'],
  ]);
  const names = new Map([
    ['sakura','櫻坂46'],
    ['hinata','日向坂46'],
    ['nogi','乃木坂46'],
  ]);
  let chartRequests = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'c.y.qq.com') {
      const query = url.searchParams.get('key');
      const mid = mids.get(query);
      return jsonResponse({ data:{ singer:{ itemlist:mid ? [{name:query,mid}] : [] } } });
    }
    const data = JSON.parse(url.searchParams.get('data'));
    const request = data.req_1;
    if (request.method === 'GetDetail') {
      chartRequests += 1;
      throw new Error('Japan toplist must not run in regular collection');
    }
    assert.equal(request.method, 'GetSingerSongList');
    const singerMid = request.param.singerMid;
    return jsonResponse({ req_1:{ data:{ songList:[{ songInfo:{
      mid:`track-${singerMid}`,
      title:`Song ${singerMid}`,
      album:{name:'Catalog'},
      singer:[{mid:singerMid,name:names.get(singerMid)}],
    } }] } } });
  };

  const writes = [];
  const env = { REGIONAL_MUSIC_SNAPSHOT_STORE:async (field,value) => writes.push({field,value}) };
  const result = await collectQqMusic(env, Date.parse('2026-10-02T15:00:00Z'), fetchImpl);
  assert.equal(result.status, 'ok');
  assert.equal(result.artists, 3);
  assert.equal(result.tracks, 3);
  assert.equal(chartRequests, 0);
  assert.equal(writes.some((row) => row.field === 'playlists'), false);
});
