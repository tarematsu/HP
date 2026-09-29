import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachStationheadTrackIds,
  configureStationheadTrackResolver,
} from '../src/spotify-stationhead-identity.js';

test('Spotify ids resolve to the existing Stationhead track only through ISRC-backed rows', async () => {
  const queries = [];
  const bindings = [];
  const db = {
    prepare(sql) {
      queries.push(sql);
      return {
        bind(...values) {
          bindings.push(values);
          return {
            async all() {
              return {
                results: values.includes('spotify-a')
                  ? [{ spotify_id: 'spotify-a', stationhead_track_id: 42 }]
                  : [],
              };
            },
          };
        },
      };
    },
  };

  configureStationheadTrackResolver(db);
  const tracks = await attachStationheadTrackIds([
    { track_id: 'spotify-a', name: 'A' },
    { track_id: 'spotify-b', name: 'B' },
  ]);

  assert.equal(tracks[0].stationhead_track_id, 42);
  assert.equal(tracks[1].stationhead_track_id, undefined);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /alias\.alias_type='spotify_id'/);
  assert.match(queries[0], /track\.isrc IS NOT NULL/);
  assert.match(queries[0], /TRIM\(track\.isrc\)<>''/);
  assert.deepEqual(bindings[0], ['spotify-a', 'spotify-b']);

  await attachStationheadTrackIds([{ track_id: 'spotify-a' }, { track_id: 'spotify-b' }]);
  assert.equal(queries.length, 1, 'cached hit and miss avoid repeated D1 reads');
  configureStationheadTrackResolver(null);
});
