import assert from 'node:assert/strict';
import test from 'node:test';

import { repairPlaybackReadModels } from '../src/buddies-facts-sync.js';

function queueDb(canonicalMetadata, updates, metadataCalls = []) {
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
                title: null,
                artist: null,
                thumbnail_url: null,
              }] }),
            }] };
          }
          if (/FROM sh_track_canonical_metadata/.test(sql)) {
            metadataCalls.push({ sql, bindings: this.bindings });
            const wanted = new Set(this.bindings);
            const key = /WHERE isrc IN/.test(sql) ? 'isrc' : 'spotify_id';
            return { results: canonicalMetadata.filter((row) => wanted.has(row[key])) };
          }
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

function forbiddenDb(calls) {
  return {
    prepare(sql) {
      calls.push(sql);
      throw new Error('BUDDIES_DB must not supplement a working canonical view');
    },
  };
}

test('metadata sync repairs an already persisted sparse playback queue', async () => {
  const updates = [];
  const db = queueDb([{
    track_id: 1,
    spotify_id: 'sp1',
    isrc: 'JPX1',
    title: 'Song',
    artist: 'Artist',
    thumbnail_url: 'https://img.example/cover.jpg',
    fetched_at: 10,
  }], updates);

  const result = await repairPlaybackReadModels({ MINUTE_DB: db });

  assert.deepEqual(result, { repaired: 1, skipped: false });
  assert.equal(updates.length, 1);
  const saved = JSON.parse(updates[0].bindings[0]);
  assert.deepEqual(saved.tracks[0], {
    position: 0,
    spotify_id: 'sp1',
    isrc: 'JPX1',
    title: 'Song',
    artist: 'Artist',
    album_name: null,
    thumbnail_url: 'https://img.example/cover.jpg',
  });
});

test('playback repair does not blend BUDDIES metadata into an available canonical view', async () => {
  const updates = [];
  const sourceCalls = [];
  const minuteDb = queueDb([{
    track_id: 1,
    spotify_id: 'sp1',
    isrc: 'JPX1',
    title: 'Canonical Song',
    artist: 'Canonical Artist',
    thumbnail_url: 'https://img.example/canonical.jpg',
    fetched_at: 20,
  }], updates);

  const result = await repairPlaybackReadModels({
    MINUTE_DB: minuteDb,
    BUDDIES_DB: forbiddenDb(sourceCalls),
  });

  assert.deepEqual(result, { repaired: 1, skipped: false });
  assert.deepEqual(sourceCalls, []);
  const saved = JSON.parse(updates[0].bindings[0]);
  assert.equal(saved.tracks[0].title, 'Canonical Song');
  assert.equal(saved.tracks[0].artist, 'Canonical Artist');
  assert.equal(saved.tracks[0].thumbnail_url, 'https://img.example/canonical.jpg');
});

test('playback repair scans incomplete tracks once and preserves first-seen unique keys', async () => {
  const metadataCalls = [];
  const queue = {
    tracks: [
      {
        spotify_id: 'complete',
        isrc: 'DONE1',
        title: 'Complete',
        artist: 'Artist',
        thumbnail_url: 'https://img.example/complete.jpg',
      },
      { spotify_id: 'sp1', isrc: 'jpx1', title: null, artist: null, thumbnail_url: null },
      { spotify_id: 'sp1', isrc: 'JPX1', title: null, artist: null, thumbnail_url: null },
      { spotify_id: null, isrc: 'jpx2', title: null, artist: null, thumbnail_url: null },
      { spotify_id: 'sp2', isrc: null, title: null, artist: null, thumbnail_url: null },
    ],
  };
  const minuteDb = {
    prepare(sql) {
      const statement = {
        bindings: [],
        bind(...bindings) { this.bindings = bindings; return this; },
        async all() {
          if (/FROM sh_queue_read_model_current/.test(sql)) {
            return { results: [{ channel_id: 1, queue_json: JSON.stringify(queue) }] };
          }
          if (/FROM sh_track_canonical_metadata/.test(sql)) {
            metadataCalls.push(this.bindings);
            return { results: [] };
          }
          return { results: [] };
        },
      };
      return statement;
    },
  };

  const result = await repairPlaybackReadModels({ MINUTE_DB: minuteDb });

  assert.deepEqual(result, { repaired: 0, skipped: false });
  assert.deepEqual(metadataCalls, [['JPX1', 'JPX2'], ['sp1', 'sp2']]);
});
