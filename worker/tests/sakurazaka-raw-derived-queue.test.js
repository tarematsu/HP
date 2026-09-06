import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeQueue, queueHash } from '../src/cloud-host-monitor-normalize.js';

function station(biteCount = 3) {
  return {
    id: 900,
    queue: {
      id: 55,
      start_time: 1_700_000_000_000,
      is_paused: false,
      queue_tracks: [{
        id: 700,
        track: {
          id: 800,
          spotify_id: 'spotify-1',
          apple_music_id: 'apple-1',
          deezer_id: 'deezer-1',
          isrc: 'JPTEST001',
          duration: 240_000,
          preview: 'https://example.com/preview.mp3',
          bite_count: biteCount,
          title: 'Track title',
          artist: { name: 'Artist name' },
          album: {
            name: 'Album name',
            images: [{ url: 'https://example.com/art.jpg' }],
          },
        },
      }],
    },
  };
}

test('raw-derived queue keeps Buddies-equivalent identifiers, likes, and presentation metadata', () => {
  const queue = normalizeQueue(station(), 1_700_000_010_000);
  assert.equal(queue.station_id, 900);
  assert.equal(queue.queue_id, 55);
  assert.equal(queue.current_track_id, 800);
  assert.equal(queue.current_spotify_id, 'spotify-1');
  assert.deepEqual(queue.tracks[0], {
    position: 0,
    queue_track_id: 700,
    stationhead_track_id: 800,
    spotify_id: 'spotify-1',
    apple_music_id: 'apple-1',
    deezer_id: 'deezer-1',
    isrc: 'JPTEST001',
    duration_ms: 240_000,
    preview_url: 'https://example.com/preview.mp3',
    bite_count: 3,
    title: 'Track title',
    artist: 'Artist name',
    album_name: 'Album name',
    thumbnail_url: 'https://example.com/art.jpg',
  });
});

test('queue hash changes when bite/like count changes even if playback queue identity does not', async () => {
  const before = normalizeQueue(station(3), 1_700_000_010_000);
  const after = normalizeQueue(station(4), 1_700_000_010_000);
  assert.notEqual(await queueHash(before), await queueHash(after));
});
