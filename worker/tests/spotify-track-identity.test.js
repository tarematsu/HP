import assert from 'node:assert/strict';
import test from 'node:test';
import { spotifySongKey } from '../src/spotify-track-identity.js';

function track(overrides = {}) {
  return {
    track_id: 'spotify-track-a',
    name: 'Start over!',
    duration_ms: 199420,
    artists_json: JSON.stringify([
      { id: 'artist-b', name: 'Guest' },
      { id: 'artist-a', name: '櫻坂46' },
    ]),
    ...overrides,
  };
}

test('same song across different Spotify track ids and durations resolves to one identity', () => {
  const single = spotifySongKey(track({ track_id: 'single-id' }));
  const album = spotifySongKey(track({
    track_id: 'album-id',
    name: 'Ｓｔａｒｔ ｏｖｅｒ！',
    duration_ms: 202900,
    artists_json: JSON.stringify([
      { id: 'artist-a', name: '櫻坂46' },
      { id: 'artist-b', name: 'Guest' },
    ]),
  }));
  assert.equal(single, album);
});

test('Stationhead ISRC-backed identity takes precedence over Spotify metadata', () => {
  const first = spotifySongKey(track({
    track_id: 'single-id',
    stationhead_track_id: 42,
    name: 'Title A',
    artists_json: '[]',
  }));
  const second = spotifySongKey(track({
    track_id: 'album-id',
    stationhead_track_id: 42,
    name: 'Title B',
    artists_json: JSON.stringify([{ id: 'other-artist' }]),
  }));
  assert.equal(first, 'stationhead:v1:42');
  assert.equal(first, second);
});

test('compact artist-id storage preserves Spotify fallback identity', () => {
  assert.equal(
    spotifySongKey(track()),
    spotifySongKey(track({
      track_id: 'compact-id',
      artists_json: JSON.stringify(['artist-b', 'artist-a']),
    })),
  );
});

test('version labels remain distinct', () => {
  assert.notEqual(
    spotifySongKey(track()),
    spotifySongKey(track({ track_id: 'live-id', name: 'Start over! - Live' })),
  );
  assert.notEqual(
    spotifySongKey(track()),
    spotifySongKey(track({ track_id: 'remix-id', name: 'Start over! - Remix' })),
  );
});

test('different credited artists remain distinct', () => {
  assert.notEqual(
    spotifySongKey(track()),
    spotifySongKey(track({
      track_id: 'other-credit-id',
      artists_json: JSON.stringify([{ id: 'artist-a', name: '櫻坂46' }]),
    })),
  );
});

test('duration is not required when title and artist identity are available', () => {
  assert.equal(
    spotifySongKey(track({ duration_ms: null })),
    spotifySongKey(track({ track_id: 'other-id', duration_ms: 999999 })),
  );
});

test('missing title or artist identity falls back to the Spotify track id', () => {
  assert.equal(
    spotifySongKey(track({ track_id: 'fallback-id', name: '' })),
    'track:v2:fallback-id',
  );
  assert.equal(
    spotifySongKey(track({ track_id: 'fallback-artists', artists_json: '[]' })),
    'track:v2:fallback-artists',
  );
});
