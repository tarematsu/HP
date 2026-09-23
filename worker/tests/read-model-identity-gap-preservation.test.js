import assert from 'node:assert/strict';
import test from 'node:test';

import {
  queueNeedsPreservation,
  readModelMetadataTask,
} from '../src/read-model-metadata-plan.js';
import { preserveReadModelForWrite } from '../src/read-model-stages.js';

function readModel(track) {
  return {
    channel: { channel_id: 10, observed_at: 200_000 },
    queue: {
      queue_id: 9,
      start_time: 100_000,
      value: { tracks: [track] },
    },
  };
}

function environment(previousTrack) {
  return {
    MINUTE_DB: {
      prepare() {
        return {
          bind() { return this; },
          async first() {
            return {
              queue_id: 9,
              start_time: 100_000,
              queue_json: JSON.stringify({ tracks: [previousTrack] }),
            };
          },
        };
      },
    },
  };
}

test('identity-free incomplete tracks are routed through preservation', () => {
  const track = {
    position: 0,
    duration_ms: 240_000,
    title: null,
    artist: null,
    album_name: null,
    thumbnail_url: null,
  };
  assert.equal(queueNeedsPreservation({ tracks: [track] }), true);
  assert.equal(readModelMetadataTask(readModel(track)), 'read-model-preserve');
});

test('title and artist without provider ids are routed through identity hydration', () => {
  const track = {
    position: 0,
    duration_ms: 240_000,
    title: 'Known Song',
    artist: 'Known Artist',
    album_name: 'Known Album',
    thumbnail_url: 'https://example.invalid/cover.jpg',
  };
  assert.equal(queueNeedsPreservation({ tracks: [track] }), true);
  assert.equal(readModelMetadataTask(readModel(track)), 'read-model-hydration');
});

test('same queue position keeps known metadata across a temporary identity gap', async () => {
  const previousTrack = {
    position: 0,
    duration_ms: 240_000,
    spotify_id: 'known-track',
    title: 'Known Song',
    artist: 'Known Artist',
    album_name: 'Known Album',
    thumbnail_url: 'https://example.invalid/cover.jpg',
  };
  const currentTrack = {
    position: 0,
    duration_ms: 240_000,
    title: null,
    artist: null,
    album_name: null,
    thumbnail_url: null,
  };

  const preserved = await preserveReadModelForWrite(environment(previousTrack), readModel(currentTrack));
  assert.deepEqual(preserved.queue.value.tracks[0], {
    ...currentTrack,
    title: 'Known Song',
    artist: 'Known Artist',
    album_name: 'Known Album',
    thumbnail_url: 'https://example.invalid/cover.jpg',
  });
});

test('position fallback does not cross a changed duration or conflicting identity', async () => {
  const previousTrack = {
    position: 0,
    duration_ms: 240_000,
    spotify_id: 'previous-track',
    title: 'Previous Song',
    artist: 'Previous Artist',
    album_name: 'Previous Album',
    thumbnail_url: 'previous-cover',
  };

  const durationChanged = {
    position: 0,
    duration_ms: 241_000,
    title: null,
    artist: null,
    album_name: null,
    thumbnail_url: null,
  };
  const durationResult = await preserveReadModelForWrite(
    environment(previousTrack),
    readModel(durationChanged),
  );
  assert.equal(durationResult.queue.value.tracks[0].title, null);

  const conflictingIdentity = {
    position: 0,
    duration_ms: 240_000,
    spotify_id: 'different-track',
    title: null,
    artist: null,
    album_name: null,
    thumbnail_url: null,
  };
  const identityResult = await preserveReadModelForWrite(
    environment(previousTrack),
    readModel(conflictingIdentity),
  );
  assert.equal(identityResult.queue.value.tracks[0].title, null);
});
