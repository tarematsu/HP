import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeTrackRows } from '../functions/lib/canonical-track-rows.js';

function fakeDb() {
  const queries = [];
  const db = {
    batch() {},
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async all() {
              queries.push({ sql, bindings });
              if (/FROM sh_tracks WHERE stationhead_track_id IN/.test(sql)) {
                return {
                  results: [{ track_id: 42, stationhead_track_id: 9001 }],
                };
              }
              if (/FROM sh_tracks t/.test(sql) && /LEFT JOIN sh_track_dictionary d/.test(sql)) {
                return {
                  results: [{
                    track_id: 42,
                    stationhead_track_id: 9001,
                    isrc: 'JPAAA0000042',
                    spotify_id: 'spotify-42',
                    title: 'Canonical Song',
                    artist: '櫻坂46',
                    thumbnail_url: 'https://example.test/42.jpg',
                  }],
                };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { db, queries };
}

const canonicalSeed = {
  track_id: 42,
  stationhead_track_id: 9001,
  isrc: 'JPAAA0000042',
  spotify_id: 'spotify-42',
  title: 'Canonical Song',
  artist: '櫻坂46',
  thumbnail_url: 'https://example.test/42.jpg',
};

test('Stationhead aliases resolve through indexed sh_tracks before physical presentation metadata', async () => {
  const { db, queries } = fakeDb();
  const rows = await canonicalizeTrackRows(db, [{
    stationhead_track_id: 9001,
    isrc: 'JPAAA0000042',
    spotify_id: 'spotify-42',
    title: null,
    artist: null,
  }]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 42);
  assert.equal(rows[0].title, 'Canonical Song');
  assert.equal(rows[0].artist, '櫻坂46');
  assert.equal(rows[0].thumbnail_url, 'https://example.test/42.jpg');

  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /FROM sh_tracks WHERE stationhead_track_id IN/);
  assert.deepEqual(queries[0].bindings, [9001]);
  assert.match(queries[1].sql, /FROM sh_tracks t/);
  assert.match(queries[1].sql, /LEFT JOIN sh_track_dictionary d/);
  assert.deepEqual(queries[1].bindings, [42]);
  assert.ok(
    queries.every(({ sql }) => !/sh_track_canonical_metadata/.test(sql)),
    'runtime canonicalization must not query the UNION canonical view',
  );
  assert.ok(
    queries.every(({ sql }) => !/FROM sh_track_aliases/.test(sql)),
    'resolved Stationhead rows must not trigger provider alias fallbacks',
  );
});

test('canonical track_id suppresses Stationhead, ISRC, Spotify, and alias fallback queries', async () => {
  const { db, queries } = fakeDb();
  const rows = await canonicalizeTrackRows(db, [{
    track_id: 42,
    stationhead_track_id: 9001,
    isrc: 'JPAAA0000042',
    spotify_id: 'spotify-42',
    title: null,
    artist: null,
  }]);

  assert.equal(rows[0].title, 'Canonical Song');
  assert.equal(rows[0].artist, '櫻坂46');
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM sh_tracks t/);
  assert.match(queries[0].sql, /LEFT JOIN sh_track_dictionary d/);
  assert.deepEqual(queries[0].bindings, [42]);
});

test('trusted canonical seed suppresses all redundant D1 lookups', async () => {
  const { db, queries } = fakeDb();
  const rows = await canonicalizeTrackRows(db, [{
    track_id: 42,
    stationhead_track_id: 9001,
    isrc: 'JPAAA0000042',
    spotify_id: 'spotify-42',
    title: 'Source Song',
    artist: 'Source Artist',
    thumbnail_url: null,
  }], { seedRows: [canonicalSeed] });

  assert.equal(rows[0].track_id, 42);
  assert.equal(rows[0].title, 'Canonical Song');
  assert.equal(rows[0].artist, '櫻坂46');
  assert.equal(rows[0].thumbnail_url, 'https://example.test/42.jpg');
  assert.equal(queries.length, 0);
});
