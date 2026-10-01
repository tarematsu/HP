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

test('resolved canonical identities do not trigger metadata title scans', async () => {
  const sqlCalls = [];
  const db = {
    prepare(sql) {
      sqlCalls.push(sql);
      return {
        bind() { return this; },
        async all() {
          if (sql.includes('FROM sh_tracks')) {
            return { results: [{
              spotify_id: 'spotify-known',
              isrc: 'JPSR02600002',
              title: 'Known Song',
              artist: '櫻坂46',
              thumbnail_url: 'https://img.example/known.jpg',
              fetched_at: 30,
            }] };
          }
          return { results: [] };
        },
      };
    },
  };

  const rows = await loadTitleArtistIdentityRows(db, [{ title: 'Known Song', artist: '櫻坂46' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spotify_id, 'spotify-known');
  assert.equal(
    sqlCalls.some((sql) => sql.includes('FROM sh_track_metadata') && sql.includes('TRIM(title)')),
    false,
  );
  assert.equal(
    sqlCalls.some((sql) => sql.includes('FROM sh_isrc_metadata') && sql.includes('TRIM(title)')),
    false,
  );
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

test('large identity lookups are chunked below the D1 binding limit', async () => {
  const tracks = Array.from({ length: 174 }, (_, index) => ({
    title: `Amazon Track ${index + 1}`,
    artist: '櫻坂46',
  }));
  const rows = tracks.map((track, index) => ({
    spotify_id: `spotify-${index + 1}`,
    isrc: `JPAAA26${String(index + 1).padStart(5, '0')}`,
    title: track.title,
    artist: track.artist,
    fetched_at: index + 1,
  }));
  const bindingCounts = [];
  const db = {
    prepare(sql) {
      return {
        bindings: [],
        bind(...bindings) {
          bindingCounts.push(bindings.length);
          if (bindings.length > 79) throw new Error('too many SQL variables');
          this.bindings = bindings;
          return this;
        },
        async all() {
          if (!sql.includes('FROM sh_tracks')) return { results: [] };
          const requested = new Set(this.bindings.map((value) => String(value).trim().toLowerCase()));
          return {
            results: rows.filter((row) => requested.has(row.title.toLowerCase())),
          };
        },
      };
    },
  };

  const identityRows = await loadTitleArtistIdentityRows(db, tracks, 240);
  const resolved = attachTitleArtistIdentity(tracks, identityRows);

  assert.equal(identityRows.length, 174);
  assert.equal(resolved.filter((track) => track.isrc).length, 174);
  assert.ok(bindingCounts.length > 4);
  assert.ok(bindingCounts.every((count) => count <= 79));
});
