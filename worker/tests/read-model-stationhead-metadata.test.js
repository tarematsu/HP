import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachPlaybackReadModelTrackMetadata,
  loadPlaybackReadModelTrackMetadata,
} from '../src/read-model-stationhead-metadata.js';
import { readModelMetadataTask } from '../src/read-model-metadata-plan.js';

function metadataDb(calls) {
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
          if (/FROM sh_tracks/.test(sql)) {
            return { results: [{
              stationhead_track_id: 42,
              spotify_id: 'spotify-42',
              isrc: 'JPX42',
              title: '曲名不明',
              artist: 'アーティスト不明',
              thumbnail_url: null,
              fetched_at: 10,
            }] };
          }
          if (/FROM sh_track_dictionary/.test(sql)) return { results: [] };
          if (/FROM sh_track_metadata/.test(sql)) {
            return { results: [{
              spotify_id: 'spotify-42',
              isrc: 'JPX42',
              title: 'Resolved Song',
              artist: 'Resolved Artist',
              thumbnail_url: 'https://img.example/42.jpg',
              fetched_at: 20,
            }] };
          }
          return { results: [] };
        },
      };
      return statement;
    },
  };
}

test('Stationhead-only playback tracks bridge through sh_tracks into provider metadata', async () => {
  const calls = [];
  const queue = {
    tracks: [{
      position: 0,
      stationhead_track_id: 42,
      title: '曲名不明',
      artist: 'アーティスト不明',
      duration_ms: 240000,
    }],
  };

  const rows = await loadPlaybackReadModelTrackMetadata({ MINUTE_DB: metadataDb(calls) }, queue.tracks);
  const hydrated = attachPlaybackReadModelTrackMetadata(queue, rows);

  assert.equal(hydrated.tracks[0].title, 'Resolved Song');
  assert.equal(hydrated.tracks[0].artist, 'Resolved Artist');
  assert.equal(hydrated.tracks[0].thumbnail_url, 'https://img.example/42.jpg');
  assert.equal(hydrated.tracks[0].spotify_id, 'spotify-42');
  assert.equal(hydrated.tracks[0].isrc, 'JPX42');
  assert.ok(calls.some((call) => /FROM sh_tracks/.test(call.sql)));
  assert.ok(calls.some((call) => /FROM sh_track_metadata/.test(call.sql)));
});

test('Stationhead-only incomplete tracks are scheduled for hydration', () => {
  assert.equal(readModelMetadataTask({
    queue: {
      value: {
        tracks: [{
          stationhead_track_id: 42,
          title: '曲名不明',
          artist: 'アーティスト不明',
          thumbnail_url: null,
        }],
      },
    },
  }), 'read-model-hydration');
});
