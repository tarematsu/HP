import assert from 'node:assert/strict';
import test from 'node:test';

import { repairPlaybackReadModels } from '../src/playback-read-model-repair.js';
import { queueNeedsHydration } from '../src/read-model-metadata-plan.js';
import {
  sanitizeQueueTrackMetadata,
  trackNeedsHydration,
} from '../src/track-metadata-quality.js';

function database(updates) {
  const metadata = [{
    spotify_id: 'sp1',
    isrc: 'JPX1',
    title: 'Recovered Song',
    artist: 'Recovered Artist',
    thumbnail_url: 'https://img.example/recovered.jpg',
    fetched_at: 20,
  }];
  return {
    prepare(sql) {
      const statement = {
        bindings: [],
        bind(...bindings) { this.bindings = bindings; return this; },
        async all() {
          if (/FROM sh_queue_read_model_current/.test(sql)) {
            return { results: [{
              channel_id: 1,
              queue_json: JSON.stringify({ tracks: [{
                position: 0,
                spotify_id: 'sp1',
                isrc: 'JPX1',
                title: '曲名不明',
                artist: 'アーティスト不明',
                thumbnail_url: 'https://img.example/stale.jpg',
              }] }),
            }] };
          }
          if (/FROM sh_track_dictionary/.test(sql)) {
            throw new Error('no such table: sh_track_dictionary');
          }
          if (/FROM sh_track_metadata/.test(sql)) return { results: metadata };
          return { results: [] };
        },
        async run() {
          updates.push({ sql, bindings: this.bindings });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

test('placeholder playback names are treated as missing metadata', () => {
  const queue = { tracks: [{
    spotify_id: 'sp1',
    title: '曲名不明',
    artist: 'アーティスト不明',
    thumbnail_url: 'https://img.example/stale.jpg',
  }] };

  assert.equal(trackNeedsHydration(queue.tracks[0]), true);
  assert.equal(queueNeedsHydration(queue), true);
  assert.deepEqual(sanitizeQueueTrackMetadata(queue).tracks[0], {
    spotify_id: 'sp1',
    title: null,
    artist: null,
    thumbnail_url: 'https://img.example/stale.jpg',
  });
});

test('playback repair replaces persisted placeholders with known metadata', async () => {
  const updates = [];
  const result = await repairPlaybackReadModels({ MINUTE_DB: database(updates) });

  assert.deepEqual(result, { repaired: 1, skipped: false });
  assert.equal(updates.length, 1);
  const saved = JSON.parse(updates[0].bindings[0]);
  assert.equal(saved.tracks[0].title, 'Recovered Song');
  assert.equal(saved.tracks[0].artist, 'Recovered Artist');
  assert.equal(saved.tracks[0].thumbnail_url, 'https://img.example/stale.jpg');
});
