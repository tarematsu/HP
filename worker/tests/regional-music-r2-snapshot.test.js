import test from 'node:test';
import assert from 'node:assert/strict';
import {collectRegionalR2Snapshot,mergeRegionalR2Snapshot,regionalSnapshotFromPayload} from '../src/regional-music-r2-snapshot.js';
import {saveRegionalArtist,saveRegionalTrack,saveRegionalRelease,saveRegionalPlaylist,saveRegionalPlaylistSnapshot,saveRegionalPlaylistMembership,saveRegionalCollectorState} from '../src/regional-music-store.js';
import {collectRegionalR2Run,parseRegionalServiceSelection} from '../scripts/collect-regional-r2-actions.mjs';
const now=Date.parse('2026-10-05T15:00:00Z');

function minuteDbWithTracks(tracks) {
  let reads=0;
  return {
    get reads(){return reads;},
    prepare(){
      return {
        bind(){
          return {all:async()=>{reads+=1;return {results:tracks};}};
        },
      };
    },
  };
}

test('every store entity saves to an R2 snapshot without any D1 binding',async()=>{
  const result=await collectRegionalR2Snapshot({service:'qq_music',now,collect:async env=>{
    const base={service:'qq_music',observed_at:now};
    await saveRegionalArtist(env,{...base,canonical_artist:'sakurazaka46',followers:10});
    await saveRegionalTrack(env,{...base,service_track_id:'song',canonical_artist:'sakurazaka46',plays:123,popularity_rank:2});
    await saveRegionalTrack(env,{...base,service_track_id:'song',canonical_artist:'nogizaka46',plays:123,popularity_rank:9});
    await saveRegionalRelease(env,{...base,service_release_id:'album'});
    await saveRegionalPlaylist(env,{...base,service_playlist_id:'list'});
    await saveRegionalPlaylistSnapshot(env,{...base,service_playlist_id:'list',item_count:1});
    await saveRegionalPlaylistMembership(env,{...base,service_playlist_id:'list',service_track_id:'song',position:1});
    await saveRegionalCollectorState(env,{...base,status:'ok',last_success_at:now,entity_counts:{tracks:1}});
  }});
  assert.equal(result.tracks.length,1);
  assert.equal(result.artists.length,1);
  assert.equal(result.releases.length,1);
  assert.equal(result.playlists.length,1);
  assert.equal(result.playlist_memberships.length,1);
  assert.deepEqual(result.artist_track_orders.map(row=>row.position),[2,9]);
  assert.equal(result.day,'2026-10-06');
});

test('QQ R2 snapshot resolves new and previous Chinese-title rows to sh_tracks ids',async()=>{
  const minuteDb=minuteDbWithTracks([
    {id:77,title:'承認欲求',artist:'櫻坂46',isrc:'JP-SAK-77',spotify_id:'spotify77'},
    {id:88,title:'17分間',artist:'櫻坂46',isrc:'JP-SAK-88',spotify_id:'spotify88'},
  ]);
  const previous={
    tracks:[{service:'qq_music',service_track_id:'old',canonical_artist:'sakurazaka46',title:'17分間 (17分钟)',observed_at:1}],
    state:{last_success_at:1},
  };
  const result=await collectRegionalR2Snapshot({service:'qq_music',now,previous,bindings:{MINUTE_DB:minuteDb},collect:async env=>{
    assert.equal(env.MINUTE_DB,minuteDb);
    await saveRegionalTrack(env,{service:'qq_music',service_track_id:'new',canonical_artist:'sakurazaka46',title:'承认欲求',observed_at:now});
    await saveRegionalCollectorState(env,{service:'qq_music',status:'ok',last_success_at:now});
  }});
  assert.equal(result.tracks.find(row=>row.service_track_id==='new').canonical_track_id,77);
  assert.equal(result.tracks.find(row=>row.service_track_id==='old').canonical_track_id,88);
  assert.equal(minuteDb.reads,1);
});

test('provider failure retains previous records and an empty playlist clears memberships',async()=>{
  const previous={tracks:[{service:'qq_music',service_track_id:'old',plays:5,observed_at:1}],playlist_memberships:[{service:'qq_music',service_playlist_id:'list',service_track_id:'old'}],state:{last_success_at:1}};
  const result=await collectRegionalR2Snapshot({service:'qq_music',now,previous,collect:async env=>{
    await saveRegionalPlaylistSnapshot(env,{service:'qq_music',service_playlist_id:'list',item_count:0});
    throw new Error('HTTP 503');
  }});
  assert.equal(result.state.status,'error');
  assert.equal(result.state.last_success_at,1);
  assert.equal(result.tracks[0].observed_at,1);
  assert.equal(result.playlist_memberships.length,0);
  const payload=mergeRegionalR2Snapshot({tracks:[{service:'genie'}],services:[],playlist_memberships:previous.playlist_memberships},result);
  assert.equal(payload.tracks.length,2);
  assert.equal(payload.playlist_memberships.length,0);
  assert.equal(payload.services[0].status,'error');
});
test('first R2 migration seeds published observations without changing their timestamps',()=>{
  const payload={updated_at:now,services:[{service:'qq_music',updated_at:123,status:'ok'}],tracks:[{service:'qq_music',service_track_id:'old',observed_at:100},{service:'genie'}]};
  const snapshot=regionalSnapshotFromPayload(payload,'qq_music');
  assert.equal(snapshot.updated_at,123);
  assert.equal(snapshot.tracks.length,1);
  assert.equal(snapshot.tracks[0].observed_at,100);
  assert.equal(regionalSnapshotFromPayload(payload,'missing'),null);
});
test('daily runner invokes only NetEase with zero SQL and writes daily/latest objects',async()=>{
  const writes=[];const called=[];
  const collectors={netease_cloud_music:async env=>{called.push('netease_cloud_music');assert.equal(env.OTHER_DB,undefined);await saveRegionalCollectorState(env,{service:'netease_cloud_music',status:'ok',last_success_at:now});}};
  const result=await collectRegionalR2Run({now,collectors,load:async()=>null,save:async(key)=>writes.push(key)});
  assert.deepEqual(called,['netease_cloud_music']);
  assert.equal(result.length,1);assert.equal(writes.length,2);
});
test('Thursday 18:00 runner invokes only QQ Music and forwards canonical bindings',async()=>{
  const qqNow=Date.parse('2026-10-08T09:00:00Z');
  const writes=[];const called=[];const minuteDb={prepare(){throw new Error('no tracks should query in this test');}};
  const collectors={qq_music:async env=>{called.push('qq_music');assert.equal(env.OTHER_DB,undefined);assert.equal(env.MINUTE_DB,minuteDb);await saveRegionalCollectorState(env,{service:'qq_music',status:'ok',last_success_at:qqNow});}};
  const result=await collectRegionalR2Run({now:qqNow,collectors,load:async()=>null,save:async(key)=>writes.push(key),bindings:{MINUTE_DB:minuteDb}});
  assert.deepEqual(called,['qq_music']);
  assert.equal(result.length,1);assert.equal(writes.length,2);
});
test('explicit service selection forces only requested services even when same-day snapshots exist',async()=>{
  const writes=[];const called=[];
  const makeCollector=service=>async env=>{called.push(service);await saveRegionalCollectorState(env,{service,status:'ok',last_success_at:now});};
  const collectors={qq_music:makeCollector('qq_music'),kugou_music:makeCollector('kugou_music')};
  const result=await collectRegionalR2Run({
    now,
    services:['qq_music','kugou_music'],
    collectors,
    load:async()=>({day:'2026-10-06',state:{status:'ok'}}),
    save:async key=>writes.push(key),
  });
  assert.deepEqual(called,['qq_music','kugou_music']);
  assert.deepEqual(result.map(row=>row.service),['qq_music','kugou_music']);
  assert.equal(writes.length,4);
});
test('service selection parser deduplicates and rejects unknown services',()=>{
  assert.deepEqual(parseRegionalServiceSelection(['--services=qq_music,kugou_music,qq_music']),['qq_music','kugou_music']);
  assert.throws(()=>parseRegionalServiceSelection(['--services=qq_music,missing']),/Unknown regional services: missing/);
});
test('scheduled retry reuses complete same-day services without provider requests or writes',async()=>{
  const result=await collectRegionalR2Run({now,collectors:{},load:async()=>({day:'2026-10-06',state:{status:'ok'}}),save:async()=>{throw new Error('must not write');}});
  assert.equal(result.length,1);
  assert.ok(result.every(row=>row.reused));
});
