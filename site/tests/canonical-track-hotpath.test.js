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

test('Stationhead aliases resolve through indexed sh_tracks before canonical metadata', async () => {
  const { db, queries } = fakeDb();
  const rows = await canonicalizeTrackRows(db, [{
    stationhead_track_id: 9001,
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
});
