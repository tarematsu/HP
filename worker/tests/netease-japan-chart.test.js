import test from 'node:test';
import assert from 'node:assert/strict';
import {
  neteaseJapanChartUrl,
  parseNeteaseJapanChart,
} from '../src/regional-music-netease.js';
import {
  NETEASE_JAPAN_CHART_ID,
  NETEASE_JAPAN_HISTORY_VIEW_KEY,
  neteaseJapanHistoryRecordFromSnapshot,
  neteaseJapanHistoryView,
  upsertNeteaseJapanHistoryArtifacts,
} from '../src/netease-japan-chart-history.js';

test('NetEase Japanese chart uses the provider-internal Japanese toplist', () => {
  assert.equal(NETEASE_JAPAN_CHART_ID, '5059644681');
  assert.match(neteaseJapanChartUrl(), /playlist\/detail\?id=5059644681$/);
});

test('parseNeteaseJapanChart keeps only current Sakamichi groups and preserves chart rank', () => {
  const parsed = parseNeteaseJapanChart({
    code:200,
    playlist:{
      id:5059644681,
      name:'网易云日语榜',
      updateTime:Date.parse('2026-09-29T00:00:00Z'),
      trackCount:6,
      tracks:[
        { id:1,name:'Other',ar:[{id:1,name:'Other'}],al:{name:'x'} },
        { id:2,name:'Sakura',ar:[{id:2,name:'櫻坂46'}],al:{name:'a'} },
        { id:3,name:'Keyaki',ar:[{id:3,name:'欅坂46'}],al:{name:'b'} },
        { id:4,name:'Nogi',ar:[{id:4,name:'乃木坂46'}],al:{name:'c'} },
        { id:5,name:'Hiragana',ar:[{id:5,name:'けやき坂46'}],al:{name:'d'} },
        { id:6,name:'Hina',ar:[{id:6,name:'日向坂46'}],al:{name:'e'} },
      ],
    },
  });
  assert.equal(parsed.id, '5059644681');
  assert.equal(parsed.track_count, 6);
  assert.deepEqual(parsed.entries.map((row) => [row.rank,row.title,row.canonical_artist]), [
    [2,'Sakura','sakurazaka46'],
    [4,'Nogi','nogizaka46'],
    [6,'Hina','hinatazaka46'],
  ]);
});

test('NetEase Japanese chart history records no-match weeks and rank-in weeks', () => {
  const noMatch = neteaseJapanHistoryRecordFromSnapshot({
    service:'netease_cloud_music',day:'2026-09-22',
    playlists:[{service_playlist_id:'5059644681',provider_update_date:'2026-09-22'}],
    playlist_memberships:[],tracks:[],
  },1);
  const ranked = neteaseJapanHistoryRecordFromSnapshot({
    service:'netease_cloud_music',day:'2026-09-29',
    playlists:[{service_playlist_id:'5059644681',provider_update_date:'2026-09-29',provider_updated_at:2}],
    playlist_memberships:[{service_playlist_id:'5059644681',service_track_id:'10',position:8}],
    tracks:[{service_track_id:'10',canonical_artist:'nogizaka46',title:'Example',album_name:'Single'}],
  },2);
  const view = neteaseJapanHistoryView([noMatch,ranked],3);
  assert.equal(view.coverage.stored_periods,2);
  assert.equal(view.coverage.entries,1);
  assert.deepEqual(view.periods.map((row) => row.period),['2026-09-22','2026-09-29']);
  assert.equal(view.history[0].rank,8);
});

test('NetEase history upsert avoids rewriting an unchanged provider week', async () => {
  const store = new Map();
  const load = async (key) => store.get(key) || null;
  const save = async (key,value) => store.set(key,value);
  const record = {
    version:1,service:'netease_cloud_music',chart:'netease_japanese_toplist',playlist_id:'5059644681',
    period:'2026-09-29',published_at:'2026-09-29',provider_updated_at:10,collected_at:10,
    entries:[{position:3,track_id:'1',title:'Track',album_name:'A',canonical_artist:'sakurazaka46'}],
  };
  const first = await upsertNeteaseJapanHistoryArtifacts({load,save,record,updatedAt:11});
  const second = await upsertNeteaseJapanHistoryArtifacts({load,save,record,updatedAt:12});
  assert.equal(first.changed,true);
  assert.equal(second.changed,false);
  assert.equal(store.get(NETEASE_JAPAN_HISTORY_VIEW_KEY).coverage.stored_periods,1);
});
