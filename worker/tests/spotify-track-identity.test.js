import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bootstrapSpotifyTrackAliases,
  resetSpotifyAliasBootstrapVerification,
  spotifySongKey,
} from '../src/spotify-track-identity.js';

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

test('same song across different Spotify track ids resolves to one identity', () => {
  const single = spotifySongKey(track({ track_id: 'single-id' }));
  const album = spotifySongKey(track({
    track_id: 'album-id',
    name: 'Ｓｔａｒｔ ｏｖｅｒ！',
    duration_ms: 199399,
    artists_json: JSON.stringify([
      { id: 'artist-a', name: '櫻坂46' },
      { id: 'artist-b', name: 'Guest' },
    ]),
  }));
  assert.equal(single, album);
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

test('missing identity metadata falls back to the Spotify track id', () => {
  assert.equal(
    spotifySongKey(track({ track_id: 'fallback-id', duration_ms: null })),
    'track:v1:fallback-id',
  );
});

test('alias bootstrap avoids the full legacy anti-join once aliases exist', async () => {
  resetSpotifyAliasBootstrapVerification();
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        async first() { return { source_track_id: 'existing-alias' }; },
        async all() { throw new Error('full alias scan must not run'); },
      };
    },
  };

  assert.equal(await bootstrapSpotifyTrackAliases(db, Date.now()), 0);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /FROM sh_spotify_track_aliases LIMIT 1/);
  assert.doesNotMatch(statements[0], /LEFT JOIN sh_spotify_track_aliases/);

  assert.equal(await bootstrapSpotifyTrackAliases(db, Date.now()), 0);
  assert.equal(statements.length, 1);
  resetSpotifyAliasBootstrapVerification();
});
