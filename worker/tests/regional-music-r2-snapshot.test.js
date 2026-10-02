import test from 'node:test';
import assert from 'node:assert/strict';
import {collectRegionalR2Snapshot,mergeRegionalR2Snapshot} from '../src/regional-music-r2-snapshot.js';
import {saveRegionalArtist,saveRegionalTrack,saveRegionalRelease,saveRegionalPlaylist,saveRegionalPlaylistSnapshot,saveRegionalPlaylistMembership,saveRegionalCollectorState} from '../src/regional-music-store.js';
import {collectRegionalR2Run} from '../scripts/collect-regional-r2-actions.mjs';
const now=Date.parse('2026-10-05T15:00:00Z');
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
  const payload=mergeRegionalR2Snapshot({tracks:[{service:'genie'}],services:[]},result);
  assert.equal(payload.tracks.length,2);
  assert.equal(payload.services[0].status,'error');
});
test('daily runner invokes only NetEase and QQ with zero SQL and writes daily/latest objects',async()=>{
  const writes=[];const called=[];
  const collectors=Object.fromEntries(['netease_cloud_music','qq_music'].map(service=>[service,async env=>{called.push(service);assert.equal(env.OTHER_DB,undefined);await saveRegionalCollectorState(env,{service,status:'ok',last_success_at:now});}]));
  const result=await collectRegionalR2Run({now,collectors,load:async()=>null,save:async(key)=>writes.push(key)});
  assert.deepEqual(called,['netease_cloud_music','qq_music']);
  assert.equal(result.length,2);assert.equal(writes.length,4);
});
