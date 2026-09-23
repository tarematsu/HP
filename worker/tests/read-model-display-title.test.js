import assert from 'node:assert/strict';
import test from 'node:test';

import { extractQueue, minuteFactQueue } from '../src/collector-payload.js';
import {
  sanitizeQueueTrackMetadata,
  trackDisplayTitleParts,
  trackNeedsHydration,
} from '../src/track-metadata-quality.js';

test('collector retains Stationhead display_title and derives missing title and artist', () => {
  const queue = extractQueue({
    current_station: {
      id: 5,
      queue: {
        id: 9,
        queue_tracks: [{
          id: 3,
          track: {
            id: 7,
            spotify_id: 'spotify-7',
            display_title: 'Display Song — Display Artist',
            duration: 180_000,
          },
        }],
      },
    },
  }, 5);

  assert.equal(queue.tracks[0].display_title, 'Display Song — Display Artist');
  assert.equal(queue.tracks[0].title, 'Display Song');
  assert.equal(queue.tracks[0].artist, 'Display Artist');
  assert.strictEqual(minuteFactQueue(queue), queue);
});

test('minute fact compaction recovers presentation from raw display_title', () => {
  const queue = minuteFactQueue({
    tracks: [{
      position: 0,
      spotify_id: 'spotify-raw',
      raw: { track: { display_title: 'Raw Song — Raw Artist' } },
    }],
  });

  assert.equal(queue.tracks[0].display_title, 'Raw Song — Raw Artist');
  assert.equal(queue.tracks[0].title, 'Raw Song');
  assert.equal(queue.tracks[0].artist, 'Raw Artist');
});

test('read model sanitizer converts display_title into canonical title and artist', () => {
  const queue = sanitizeQueueTrackMetadata({
    tracks: [{
      spotify_id: 'spotify-display',
      title: '曲名不明',
      artist: 'アーティスト不明',
      display_title: 'Resolved Song — Resolved Artist',
      thumbnail_url: 'cover',
    }],
  });

  assert.equal(queue.tracks[0].title, 'Resolved Song');
  assert.equal(queue.tracks[0].artist, 'Resolved Artist');
  assert.equal(trackNeedsHydration(queue.tracks[0]), false);
});

test('display title parsing does not overwrite a known direct title', () => {
  assert.deepEqual(trackDisplayTitleParts('Known Song — Known Artist', 'Known Song'), {
    displayTitle: 'Known Song — Known Artist',
    title: 'Known Song',
    artist: 'Known Artist',
  });
});
