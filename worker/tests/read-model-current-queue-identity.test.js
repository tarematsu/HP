import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachPlaybackReadModelTrackMetadata,
  loadPlaybackReadModelTrackMetadata,
} from '../src/read-model-stationhead-metadata.js';

function database(calls) {
  return {
    prepare(sql) {
      const statement = {
        bindings: [],
        bind(...bindings) {
          this.bindings = bindings;
          return this;
        },
        async all() {
          calls.push({ sql, bindings: this.bindings });
          if (/JOIN sh_queue_items/.test(sql)) {
            return { results: [{
              position: 0,
              queue_track_id: 9001,
              stationhead_track_id: 77,
              spotify_id: null,
              isrc: null,
              fetched_at: 100,
            }] };
          }
          if (/FROM sh_tracks/.test(sql)) {
            return { results: [{
              stationhead_track_id: 77,
              spotify_id: 'spotify-77',
              isrc: 'JPABC770001',
              title: null,
              artist: null,
              fetched_at: 200,
            }] };
          }
          if (/FROM sh_track_dictionary/.test(sql)) return { results: [] };
          if (/FROM sh_track_metadata/.test(sql)) {
            return { results: [{
              spotify_id: 'spotify-77',
              isrc: 'JPABC770001',
              title: 'Resolved Current Song',
              artist: 'Resolved Current Artist',
              thumbnail_url: 'https://img.example/current.jpg',
              fetched_at: 300,
            }] };
          }
          return { results: [] };
        },
      };
      return statement;
    },
  };
}

test('current placeholder track resolves through persisted latest-queue identity by position', async () => {
  const calls = [];
  const queue = {
    tracks: [{
      position: 0,
      queue_track_id: null,
      stationhead_track_id: null,
      spotify_id: null,
      isrc: null,
      title: '曲名不明',
      artist: 'アーティスト不明',
      thumbnail_url: null,
      duration_ms: 238000,
    }],
  };

  const rows = await loadPlaybackReadModelTrackMetadata({ MINUTE_DB: database(calls) }, queue.tracks);
  const hydrated = attachPlaybackReadModelTrackMetadata(queue, rows);

  assert.equal(hydrated.tracks[0].queue_track_id, 9001);
  assert.equal(hydrated.tracks[0].stationhead_track_id, 77);
  assert.equal(hydrated.tracks[0].spotify_id, 'spotify-77');
  assert.equal(hydrated.tracks[0].isrc, 'JPABC770001');
  assert.equal(hydrated.tracks[0].title, 'Resolved Current Song');
  assert.equal(hydrated.tracks[0].artist, 'Resolved Current Artist');
  assert.equal(hydrated.tracks[0].thumbnail_url, 'https://img.example/current.jpg');
  assert.ok(calls.some((call) => /JOIN sh_queue_items/.test(call.sql)));
  assert.ok(calls.some((call) => /FROM sh_tracks/.test(call.sql)));
  assert.ok(calls.some((call) => /FROM sh_track_metadata/.test(call.sql)));
});
