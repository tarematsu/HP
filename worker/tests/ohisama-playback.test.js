import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveOhisamaPlaybackWindow,
  transitionedOhisamaTracks,
} from '../src/ohisama-playback.js';

function channel(startTime = 1_000_000) {
  return {
    id: 46,
    alias: 'ohisama',
    current_station_id: 99,
    current_station: {
      id: 99,
      queue: {
        id: 7,
        start_time: startTime,
        is_paused: false,
        queue_tracks: Array.from({ length: 8 }, (_, index) => ({
          id: 100 + index,
          track: {
            id: 200 + index,
            spotify_id: `spotify-${index}`,
            isrc: `JPTEST00000${index}`,
            duration: 180_000,
            bite_count: 10 + index,
            title: `Track ${index}`,
            artist: { name: 'Hinatazaka46' },
          },
        })),
      },
    },
  };
}

test('Ohisama playback keeps current track plus five upcoming tracks', () => {
  const start = 1_000_000;
  const playback = resolveOhisamaPlaybackWindow(channel(start), 99, start + 180_000 + 30_000);
  assert.equal(playback.queue.length, 6);
  assert.equal(playback.queue[0].title, 'Track 1');
  assert.equal(playback.queue[0].is_current, true);
  assert.equal(playback.queue[5].title, 'Track 6');
  assert.equal(playback.queue_status.current_index, 0);
  assert.equal(playback.queue_status.progress_ms, 30_000);
  assert.equal(playback.queue_status.total_items, 7);
});

test('Ohisama playback infers tracks passed between five-minute polls', () => {
  const start = 1_000_000;
  const previous = resolveOhisamaPlaybackWindow(channel(start), 99, start + 30_000);
  const current = resolveOhisamaPlaybackWindow(channel(start), 99, start + 6 * 60_000 + 30_000);
  const transitioned = transitionedOhisamaTracks(previous.queue, current.queue);
  assert.deepEqual(transitioned.map((track) => track.title), ['Track 1', 'Track 2']);
});

test('unchanged Ohisama current queue entry does not create a new play transition', () => {
  const start = 1_000_000;
  const previous = resolveOhisamaPlaybackWindow(channel(start), 99, start + 30_000);
  const current = resolveOhisamaPlaybackWindow(channel(start), 99, start + 90_000);
  assert.deepEqual(transitionedOhisamaTracks(previous.queue, current.queue), []);
});
