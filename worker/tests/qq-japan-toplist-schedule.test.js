import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectQqJapanToplistAttempt,
  QQ_JAPAN_TOPLIST_MARKER_KEY,
  qqJapanToplistCycleKey,
  qqJapanToplistFingerprint,
  qqJapanToplistHasUpdated,
} from '../scripts/collect-qq-japan-toplist-actions.mjs';
import { QQ_JAPAN_TOPLIST_PLAYLIST_ID } from '../src/regional-music-qq.js';
import { regionalSnapshotKey } from '../src/regional-music-r2-snapshot.js';

const chart = (updateTime = '2026-10-01') => ({
  title:'日本榜',
  update_time:updateTime,
  entries:[
    {
      track_id:'chart-1',
      title:'One',
      album_name:'A',
      artists:[{mid:'sakura',name:'櫻坂46'}],
      canonical_artist:'sakurazaka46',
      position:1,
    },
    {
      track_id:'chart-2',
      title:'Two',
      album_name:'B',
      artists:[{mid:'other',name:'Other'}],
      canonical_artist:null,
      position:2,
    },
  ],
});

function previousSnapshot(updateTime = '2026-09-24') {
  return {
    version:1,
    service:'qq_music',
    day:'2026-10-01',
    updated_at:Date.parse('2026-10-01T00:00:00Z'),
    authoritative_fields:['artists','tracks','releases','playlists','playlist_memberships','artist_track_orders'],
    artists:[],
    tracks:[],
    releases:[],
    playlists:[{
      service:'qq_music',
      service_playlist_id:QQ_JAPAN_TOPLIST_PLAYLIST_ID,
      provider_update_time:updateTime,
    }],
    playlist_memberships:[
      {service:'qq_music',service_playlist_id:QQ_JAPAN_TOPLIST_PLAYLIST_ID,service_track_id:'chart-1',position:1},
      {service:'qq_music',service_playlist_id:QQ_JAPAN_TOPLIST_PLAYLIST_ID,service_track_id:'chart-2',position:2},
    ],
    artist_track_orders:[],
    state:{service:'qq_music',status:'ok',last_attempt_at:Date.parse('2026-10-01T00:00:00Z')},
  };
}

test('QQ Japan chart cycle starts Thursday at 18:00 JST', () => {
  assert.equal(qqJapanToplistCycleKey(Date.parse('2026-10-01T08:59:59Z')), '2026-09-24');
  assert.equal(qqJapanToplistCycleKey(Date.parse('2026-10-01T09:00:00Z')), '2026-10-01');
  assert.equal(qqJapanToplistCycleKey(Date.parse('2026-10-02T12:00:00Z')), '2026-10-01');
  assert.equal(qqJapanToplistCycleKey(Date.parse('2026-10-08T08:59:59Z')), '2026-10-01');
  assert.equal(qqJapanToplistCycleKey(Date.parse('2026-10-08T09:00:00Z')), '2026-10-08');
});

test('QQ Japan chart change detection uses provider update time and ordered ranking fingerprint', () => {
  const same = chart('2026-09-24');
  const previous = {
    provider_update_time:'2026-09-24',
    fingerprint:qqJapanToplistFingerprint(same.entries),
  };
  assert.equal(qqJapanToplistHasUpdated(previous, same), false);
  assert.equal(qqJapanToplistHasUpdated(previous, chart('2026-10-01')), true);
  const reordered = chart('2026-09-24');
  reordered.entries.reverse();
  reordered.entries.forEach((row,index) => { row.position=index+1; });
  assert.equal(qqJapanToplistHasUpdated(previous, reordered), true);
  assert.equal(qqJapanToplistHasUpdated({provider_update_time:null,fingerprint:''}, same), true);
});

test('successful cycle marker skips QQ network access on later hourly runs', async () => {
  const now = Date.parse('2026-10-01T11:00:00Z');
  let fetched = 0;
  const result = await collectQqJapanToplistAttempt({
    now,
    load:async (key) => key === QQ_JAPAN_TOPLIST_MARKER_KEY
      ? {version:1,cycle:'2026-10-01',status:'updated',provider_update_time:'2026-10-01',entries:100}
      : null,
    save:async () => assert.fail('already updated cycle must not write'),
    fetchChart:async () => { fetched += 1; return chart(); },
  });
  assert.equal(result.status, 'already_updated');
  assert.equal(fetched, 0);
});

test('unchanged provider chart retries later without overwriting R2', async () => {
  const now = Date.parse('2026-10-01T09:00:00Z');
  const previous = previousSnapshot('2026-10-01');
  const writes = [];
  const result = await collectQqJapanToplistAttempt({
    now,
    load:async (key) => key === regionalSnapshotKey('qq_music') ? previous : null,
    save:async (key,value) => writes.push({key,value}),
    fetchChart:async () => chart('2026-10-01'),
  });
  assert.equal(result.status, 'not_updated');
  assert.equal(writes.length, 0);
});

test('new provider update is merged into QQ R2 snapshot and closes the weekly cycle', async () => {
  const now = Date.parse('2026-10-01T10:00:00Z');
  const previous = previousSnapshot('2026-09-24');
  const objects = new Map([[regionalSnapshotKey('qq_music'), previous]]);
  const writes = [];
  const result = await collectQqJapanToplistAttempt({
    now,
    load:async (key) => structuredClone(objects.get(key) ?? null),
    save:async (key,value) => {
      writes.push({key,value:structuredClone(value)});
      objects.set(key,structuredClone(value));
    },
    fetchChart:async () => chart('2026-10-01'),
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.cycle, '2026-10-01');
  const latest = objects.get(regionalSnapshotKey('qq_music'));
  assert.equal(latest.state.status, 'ok');
  assert.equal(latest.playlists.find((row) => row.service_playlist_id === QQ_JAPAN_TOPLIST_PLAYLIST_ID).provider_update_time, '2026-10-01');
  assert.deepEqual(
    latest.playlist_memberships
      .filter((row) => row.service_playlist_id === QQ_JAPAN_TOPLIST_PLAYLIST_ID)
      .map((row) => row.position),
    [1,2],
  );
  const marker = objects.get(QQ_JAPAN_TOPLIST_MARKER_KEY);
  assert.equal(marker.cycle, '2026-10-01');
  assert.equal(marker.status, 'updated');
  assert.equal(marker.provider_update_time, '2026-10-01');
  assert.ok(writes.some((row) => row.key.includes('/days/')));
});
