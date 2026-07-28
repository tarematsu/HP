import assert from 'node:assert/strict';
import test from 'node:test';

import {
  queueItemsToWriteLean,
  queueStructuralPayload,
} from '../functions/lib/d1-lean-ingest.js';
import { payloadHash } from '../functions/lib/ingest-claim.js';

function formattedTrack() {
  return {
    position: 0,
    queue_track_id: 101,
    stationhead_track_id: 202,
    spotify_id: '  spotify-track-id  ',
    deezer_id: 'deezer-track-id',
    isrc: ' jpabc1234567 ',
    duration_ms: 180_000,
    preview_url: null,
  };
}

function canonicalTrack() {
  return {
    position: 0,
    queue_track_id: 101,
    stationhead_track_id: 202,
    spotify_id: 'spotify-track-id',
    deezer_id: 'deezer-track-id',
    isrc: 'JPABC1234567',
    duration_ms: 180_000,
    preview_url: null,
  };
}

test('queue structural identity ignores Spotify whitespace and ISRC case formatting', async () => {
  const base = { station_id: 1, queue_id: 2, start_time: 3, is_paused: false };
  const formatted = queueStructuralPayload({ ...base, tracks: [formattedTrack()] });
  const canonical = queueStructuralPayload({ ...base, tracks: [canonicalTrack()] });

  assert.deepEqual(formatted, canonical);
  assert.equal(formatted.tracks[0].spotify_id, 'spotify-track-id');
  assert.equal(formatted.tracks[0].isrc, 'JPABC1234567');
  assert.equal(await payloadHash(formatted), await payloadHash(canonical));
});

test('canonical queue rows are not rewritten for identifier formatting only', () => {
  const changed = queueItemsToWriteLean([formattedTrack()], [{
    ...canonicalTrack(),
    queue_id: 2,
    observed_at: 1_700_000_000_000,
  }], 2);

  assert.deepEqual(changed, []);
});

test('actual canonical identity changes still schedule a queue item write', () => {
  const changed = queueItemsToWriteLean([{
    ...formattedTrack(),
    spotify_id: 'different-track-id',
  }], [{
    ...canonicalTrack(),
    queue_id: 2,
    observed_at: 1_700_000_000_000,
  }], 2);

  assert.equal(changed.length, 1);
  assert.equal(changed[0].spotify_id, 'different-track-id');
});
