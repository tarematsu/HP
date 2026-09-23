import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachTitleArtistIdentity,
  loadTitleArtistIdentityRows,
  trackTitleArtistKey,
} from '../src/track-title-artist-identity.js';

function fakeDb(rowsByTable) {
  return {
    prepare(sql) {
      return {
        bindings: [],
        bind(...bindings) {
          this.bindings = bindings;
          return this;
        },
        async all() {
          for (const [table, rows] of Object.entries(rowsByTable)) {
            if (sql.includes(`FROM ${table}`)) return { results: rows };
          }
          return { results: [] };
        },
      };
    },
  };
}

test('title and artist recover provider identities from the local dictionary', async () => {
  const tracks = [{
    title: 'UDAGAWA GENERATION',
    artist: '櫻坂46',
    thumbnail_url: null,
  }];
  const db = fakeDb({
    sh_tracks: [{
      spotify_id: 'spotify-udagawa',
      isrc: 'JPSR02600001',
      title: 'UDAGAWA GENERATION',
      artist: '櫻坂46',
      thumbnail_url: null,
      fetched_at: 10,
    }],
    sh_track_metadata: [{
      spotify_id: 'spotify-udagawa',
      isrc: 'JPSR02600001',
      title: 'UDAGAWA GENERATION',
      artist: '櫻坂46',
      thumbnail_url: 'https://img.example/udagawa.jpg',
      fetched_at: 20,
    }],
  });

  const rows = await loadTitleArtistIdentityRows(db, tracks);
  const resolved = attachTitleArtistIdentity(tracks, rows);

  assert.equal(rows.length, 1);
  assert.equal(resolved[0].spotify_id, 'spotify-udagawa');
  assert.equal(resolved[0].isrc, 'JPSR02600001');
  assert.equal(resolved[0].thumbnail_url, 'https://img.example/udagawa.jpg');
});

test('normalization matches compatible title and artist presentation', () => {
  assert.equal(
    trackTitleArtistKey({ title: 'ＡＢＣ  Song', artist: 'ARTIST' }),
    trackTitleArtistKey({ title: 'abc song', artist: 'artist' }),
  );
});

test('conflicting Spotify identities are not guessed', async () => {
  const tracks = [{ title: 'Same Song', artist: 'Same Artist' }];
  const db = fakeDb({
    sh_tracks: [
      {
        spotify_id: 'spotify-a',
        isrc: 'JPSR02600001',
        title: 'Same Song',
        artist: 'Same Artist',
        fetched_at: 10,
      },
      {
        spotify_id: 'spotify-b',
        isrc: 'JPSR02600001',
        title: 'Same Song',
        artist: 'Same Artist',
        fetched_at: 20,
      },
    ],
  });

  const rows = await loadTitleArtistIdentityRows(db, tracks);
  const resolved = attachTitleArtistIdentity(tracks, rows);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].spotify_id, null);
  assert.equal(rows[0].isrc, 'JPSR02600001');
  assert.equal(resolved[0].spotify_id, undefined);
  assert.equal(resolved[0].isrc, 'JPSR02600001');
});
