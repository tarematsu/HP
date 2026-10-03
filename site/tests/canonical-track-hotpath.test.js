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
              if (/FROM sh_tracks WHERE spotify_id IN/.test(sql)) {
                return {
                  results: bindings.includes('spotify-42')
                    ? [{ track_id: 42, alias_value: 'spotify-42' }]
                    : [],
                };
              }
              if (/FROM sh_track_aliases/.test(sql)) {
                return {
                  results: bindings.includes('spotify-legacy')
                    ? [{ track_id: 42, alias_value: 'spotify-legacy' }]
                    : [],
                };
              }
              if (/FROM sh_track_canonical_metadata WHERE track_id IN/.test(sql)) {
                return {
                  results: [{
                    track_id: 42,
                    stationhead_track_id: null,
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

test('Stationhead aliases resolve through indexed sh_tracks before canonical metadata', async () => {
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
  assert.match(queries[1].sql, /FROM sh_track_canonical_metadata WHERE track_id IN/);
  assert.deepEqual(queries[1].bindings, [42]);
  assert.ok(
    queries.every(({ sql }) => !/LEFT JOIN sh_track_canonical_metadata/.test(sql)),
    'Stationhead lookup must not join the canonical view before track_id is resolved',
  );
  assert.ok(
    queries.every(({ sql }) => !/WHERE track_id IS NOT NULL AND (?:isrc|spotify_id) IN/.test(sql)),
    'resolved Stationhead rows must not trigger redundant provider alias scans',
  );
});

test('canonical track_id suppresses Stationhead, ISRC, and Spotify fallback queries', async () => {
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
  assert.match(queries[0].sql, /FROM sh_track_canonical_metadata WHERE track_id IN/);
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

test('Spotify IDs resolve through indexed sh_tracks before canonical metadata', async () => {
  const { db, queries } = fakeDb();
  const rows = await canonicalizeTrackRows(db, [{
    spotify_id: 'spotify-42',
    title: null,
    artist: null,
  }]);

  assert.equal(rows[0].track_id, 42);
  assert.equal(rows[0].spotify_id, 'spotify-42');
  assert.equal(rows[0].title, 'Canonical Song');
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /FROM sh_tracks WHERE spotify_id IN/);
  assert.deepEqual(queries[0].bindings, ['spotify-42']);
  assert.match(queries[1].sql, /FROM sh_track_canonical_metadata WHERE track_id IN/);
  assert.deepEqual(queries[1].bindings, [42]);
  assert.ok(
    queries.every(({ sql }) => !/sh_track_canonical_metadata WHERE track_id IS NOT NULL AND spotify_id IN/.test(sql)),
    'Spotify lookup must not filter the canonical metadata view by spotify_id',
  );
});

test('legacy Spotify aliases use indexed sh_track_aliases then canonical track_id', async () => {
  const { db, queries } = fakeDb();
  const rows = await canonicalizeTrackRows(db, [{
    spotify_id: 'spotify-legacy',
    title: null,
    artist: null,
  }]);

  assert.equal(rows[0].track_id, 42);
  assert.equal(rows[0].spotify_id, 'spotify-42');
  assert.equal(rows[0].title, 'Canonical Song');
  assert.equal(queries.length, 3);
  assert.match(queries[0].sql, /FROM sh_tracks WHERE spotify_id IN/);
  assert.match(queries[1].sql, /FROM sh_track_aliases/);
  assert.deepEqual(queries[1].bindings, ['spotify-legacy']);
  assert.match(queries[2].sql, /FROM sh_track_canonical_metadata WHERE track_id IN/);
  assert.deepEqual(queries[2].bindings, [42]);
  assert.ok(
    queries.every(({ sql }) => !/sh_track_canonical_metadata WHERE track_id IS NOT NULL AND spotify_id IN/.test(sql)),
    'legacy Spotify aliases must not scan canonical metadata by spotify_id',
  );
});
