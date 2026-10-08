import assert from 'node:assert/strict';
import test from 'node:test';

import { queueStructuralPayload } from '../functions/lib/d1-lean-ingest.js';
import { normalizeStationheadQueueTrack } from '../../worker/src/stationhead-queue-normalize.js';
import { trackDisplayTitleParts } from '../../worker/src/track-metadata-quality.js';

test('queue structural payload keeps current track identities and normalized metadata', () => {
  const payload = queueStructuralPayload({
    station_id: 1,
    queue_id: 2,
    start_time: 3,
    tracks: [{
      position: 0,
      queue_track_id: 10,
      stationhead_track_id: 20,
      spotify_id: 'sp1',
      deezer_id: 'dz1',
      isrc: 'JPTEST',
      duration_ms: 180000,
    }],
  });

  assert.deepEqual(payload.tracks[0], {
    position: 0,
    queue_track_id: 10,
    stationhead_track_id: 20,
    spotify_id: 'sp1',
    deezer_id: 'dz1',
    isrc: 'JPTEST',
    duration_ms: 180000,
    preview_url: null,
  });
});

test('Stationhead queue normalization preserves presentation metadata before publication', () => {
  const track = normalizeStationheadQueueTrack({
    track: {
      id: 20,
      spotify_id: 'sp1',
      title: 'Song',
      artist_name: 'Artist',
      duration: 180000,
    },
  }, 0);
  assert.equal(track.title, 'Song');
  assert.equal(track.artist, 'Artist');
  assert.equal(track.duration_ms, 180000);
  assert.equal(track.stationhead_track_id, 20);
});

test('shared metadata normalization derives artist from UTF-8 dash-separated display titles', () => {
  assert.equal(trackDisplayTitleParts('Song \u2014 Artist', 'Song').artist, 'Artist');
});
