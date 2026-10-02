import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatSpotifyUpdatedAt,
  latestSpotifyCollectedAt,
} from '../public/spotify-updated-at.js';

const model = {
  groups: {
    sakurazaka46: {
      tracks: [
        { collected_at: Date.parse('2026-10-02T20:01:00Z') },
        { collected_at: Date.parse('2026-10-02T20:05:00Z') },
      ],
    },
    nogizaka46: {
      tracks: [{ collected_at: Date.parse('2026-10-02T20:07:00Z') }],
    },
    hinatazaka46: {
      tracks: [{ collected_at: Date.parse('2026-10-02T20:03:00Z') }],
    },
  },
};

test('Spotify update datetime uses the latest collected_at for the selected group', () => {
  assert.equal(
    latestSpotifyCollectedAt(model, 'sakurazaka46'),
    Date.parse('2026-10-02T20:05:00Z'),
  );
});

test('Spotify all-groups update datetime uses the newest collection timestamp', () => {
  assert.equal(
    latestSpotifyCollectedAt(model, 'all'),
    Date.parse('2026-10-02T20:07:00Z'),
  );
});

test('Spotify update datetime is formatted in JST with date and time', () => {
  assert.equal(
    formatSpotifyUpdatedAt(Date.parse('2026-10-02T23:31:00Z')),
    '2026/10/03 08:31',
  );
  assert.equal(formatSpotifyUpdatedAt(null), '-');
});
