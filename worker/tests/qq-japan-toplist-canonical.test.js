import test from 'node:test';
import assert from 'node:assert/strict';
import { collectQqJapanToplistAttempt, QQ_JAPAN_TOPLIST_MARKER_KEY } from '../scripts/collect-qq-japan-toplist-actions.mjs';
import { QQ_JAPAN_TOPLIST_PLAYLIST_ID } from '../src/regional-music-qq.js';
import { regionalSnapshotKey } from '../src/regional-music-r2-snapshot.js';

function minuteDb() {
  return {
    prepare() {
      return {
        bind() {
          return {
            all: async () => ({
              results: [{ id:42, title:'One', artist:'櫻坂46', isrc:'JP-SAK-42', spotify_id:'spotify42' }],
            }),
          };
        },
      };
    },
  };
}

test('QQ Japan toplist R2 collection writes canonical sh_tracks ids', async () => {
  const now=Date.parse('2026-10-08T10:00:00Z');
  const previous={
    version:1,
    service:'qq_music',
    day:'2026-10-01',
    updated_at:now-7*24*60*60*1000,
    authoritative_fields:['artists','tracks','releases','playlists','playlist_memberships','artist_track_orders'],
    artists:[],tracks:[],releases:[],artist_track_orders:[],
    playlists:[{service:'qq_music',service_playlist_id:QQ_JAPAN_TOPLIST_PLAYLIST_ID,provider_update_time:'2026-10-01'}],
    playlist_memberships:[],
    state:{service:'qq_music',status:'ok',last_attempt_at:now-7*24*60*60*1000},
  };
  const objects=new Map([[regionalSnapshotKey('qq_music'),previous]]);
  const result=await collectQqJapanToplistAttempt({
    now,
    bindings:{MINUTE_DB:minuteDb()},
    load:async key=>structuredClone(objects.get(key) ?? null),
    save:async(key,value)=>objects.set(key,structuredClone(value)),
    fetchChart:async()=>({
      title:'日本榜',update_time:'2026-10-08',entries:[
        {track_id:'chart-1',title:'One',album_name:'A',artists:[{mid:'sakura',name:'櫻坂46'}],canonical_artist:'sakurazaka46',position:1},
      ],
    }),
  });
  assert.equal(result.status,'collected');
  const latest=objects.get(regionalSnapshotKey('qq_music'));
  assert.equal(latest.tracks.find(row=>row.service_track_id==='chart-1').canonical_track_id,42);
  assert.equal(objects.get(QQ_JAPAN_TOPLIST_MARKER_KEY).status,'collected');
});
