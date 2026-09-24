import assert from 'node:assert/strict';
import test from 'node:test';

import {
  processRawMaterializeStage,
  RAW_MATERIALIZE_MESSAGE,
} from '../src/raw-collection-preparation.js';
import { materializeDependencies } from '../src/ingest-channel-optimized-entry.js';

test('materialization hydrates the full queue before presentation_tracks is derived', async () => {
  const sent = [];
  const body = {
    message_type: RAW_MATERIALIZE_MESSAGE,
    message_version: 1,
    observed_at: 1_784_000_000_000,
    channel_alias: 'buddies',
    persist_credentials: true,
    auth: {},
    snapshot: {
      channel_id: 10,
      station_id: 123,
    },
    queue: {
      station_id: 123,
      queue_id: 456,
      start_time: 1_784_000_000_000,
      tracks: [
        {
          position: 0,
          spotify_id: 'spotify-1',
          isrc: null,
          title: null,
          artist: null,
        },
        {
          position: 1,
          spotify_id: 'spotify-2',
          isrc: null,
          title: null,
          artist: null,
        },
      ],
    },
    track_metadata: [
      {
        spotify_id: 'spotify-1',
        isrc: null,
        title: 'Song One',
        artist: 'Artist One',
        thumbnail_url: 'https://img.example/1.jpg',
      },
      {
        spotify_id: 'spotify-2',
        isrc: null,
        title: 'Song Two',
        artist: 'Artist Two',
        thumbnail_url: 'https://img.example/2.jpg',
      },
    ],
    queue_analysis: {
      structural_hash: 'queue-hash',
    },
  };

  await processRawMaterializeStage({ DB: {} }, body, {
    materialize: async (_db, queue) => {
      assert.equal(queue.tracks[0].title, 'Song One');
      assert.equal(queue.tracks[1].title, 'Song Two');
      return {
        queue: {
          ...queue,
          tracks: [queue.tracks[0]],
          presentation_tracks: queue.tracks.map((track) => ({ ...track })),
          total_track_count: 2,
          materialized_track_count: 1,
          source_structural_hash: 'queue-hash',
        },
        analysis: {
          source_structural_hash: 'queue-hash',
          total_track_count: 2,
          materialized_track_count: 1,
        },
      };
    },
    ...materializeDependencies({ COLLECTED_METADATA_PERSIST_ENABLED: false }),
    send: async (message) => sent.push(message),
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].queue.tracks[0].title, 'Song One');
  assert.equal(sent[0].queue.presentation_tracks[1].title, 'Song Two');
  assert.equal(sent[0].queue.presentation_tracks[1].artist, 'Artist Two');
});
