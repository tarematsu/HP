import assert from 'node:assert/strict';
import test from 'node:test';

import { hydrateReadModelMetadata } from '../src/read-model-stages.js';

function readModel(tracks) {
  return { queue: { value: { tracks } } };
}

function metadataEnv(calls) {
  return {
    MINUTE_DB: {
      prepare(sql) {
        return {
          bind(...bindings) {
            calls.push({ sql, bindings });
            return { all: async () => ({ results: [] }) };
          },
        };
      },
    },
  };
}

function canonicalSeedEnv(calls) {
  const canonical = {
    track_id: 7,
    spotify_id: 'sp1',
    isrc: 'JP1',
    title: 'Canonical Song',
    artist: '櫻坂46',
    thumbnail_url: 'https://example.test/cover.jpg',
    fetched_at: 100,
  };
  return {
    MINUTE_DB: {
      batch() {},
      prepare(sql) {
        return {
          bind(...bindings) {
            calls.push({ sql, bindings });
            return {
              async all() {
                if (/FROM sh_track_canonical_metadata/.test(sql)
                    && /WHERE isrc IN/.test(sql)
                    && bindings.includes('JP1')) {
                  return { results: [canonical] };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    },
  };
}

function canonicalOwnerCalls(calls) {
  return calls.filter(({ sql }) => (
    /FROM sh_track_canonical_metadata/.test(sql)
    || /FROM sh_track_dictionary/.test(sql)
  ));
}

test('metadata hydration scans incomplete tracks once and preserves key order', async () => {
  const calls = [];
  const model = readModel([
    { title: 'complete', artist: 'artist', thumbnail_url: 'image', spotify_id: 'ignored', isrc: 'ignored' },
    { spotify_id: ' spotify-a ', isrc: ' us-a ' },
    { spotify_id: 'spotify-a', isrc: 'US-A' },
    { title: 'partial', spotify_id: 'spotify-b', isrc: 'gb-b' },
    null,
  ]);

  assert.equal(await hydrateReadModelMetadata(metadataEnv(calls), model), model);
  assert.equal(calls.length, 3);
  assert.deepEqual(canonicalOwnerCalls(calls).map((call) => call.bindings), [
    ['USA', 'GBB'],
    ['spotify-a', 'spotify-b'],
  ]);
  assert.match(calls[1].sql, /FROM sh_tracks/);
  assert.match(calls[2].sql, /FROM sh_track_dictionary/);
  assert.ok(calls.every(({ sql }) => !/UNION ALL|\sOR\s/.test(sql)));
});

test('hydrated canonical metadata is reused instead of rereading the same track id', async () => {
  const calls = [];
  const result = await hydrateReadModelMetadata(canonicalSeedEnv(calls), readModel([{
    spotify_id: 'sp1',
    isrc: 'JP1',
  }]));

  const track = result.queue.value.tracks[0];
  assert.equal(track.track_id, 7);
  assert.equal(track.title, 'Canonical Song');
  assert.equal(track.artist, '櫻坂46');
  assert.equal(track.thumbnail_url, 'https://example.test/cover.jpg');
  const canonical = canonicalOwnerCalls(calls);
  assert.equal(canonical.length, 1);
  assert.match(canonical[0].sql, /WHERE isrc IN/);
  assert.deepEqual(canonical[0].bindings, ['JP1']);
});

test('metadata hydration keeps collecting the second key type after the first reaches its cap', async () => {
  const calls = [];
  const tracks = [];
  for (let index = 0; index < 90; index += 1) tracks.push({ spotify_id: `spotify-${index}` });
  for (let index = 0; index < 90; index += 1) tracks.push({ isrc: `isrc-${index}` });

  await hydrateReadModelMetadata(metadataEnv(calls), readModel(tracks));

  const isrcs = Array.from({ length: 80 }, (_, index) => `ISRC${index}`);
  const spotify = Array.from({ length: 80 }, (_, index) => `spotify-${index}`);
  assert.equal(calls.length, 3);
  assert.deepEqual(canonicalOwnerCalls(calls).map((call) => call.bindings), [isrcs, spotify]);
  assert.match(calls[1].sql, /FROM sh_tracks/);
  assert.match(calls[2].sql, /FROM sh_track_dictionary/);
});

test('metadata hydration does not spend key capacity on duplicates', async () => {
  const calls = [];
  const tracks = Array.from({ length: 20 }, () => ({
    spotify_id: ' duplicate ',
    isrc: ' duplicate ',
  }));
  for (let index = 0; index < 85; index += 1) {
    tracks.push({ spotify_id: `spotify-${index}`, isrc: `isrc-${index}` });
  }

  await hydrateReadModelMetadata(metadataEnv(calls), readModel(tracks));

  const isrcs = [
    'DUPLICATE',
    ...Array.from({ length: 79 }, (_, index) => `ISRC${index}`),
  ];
  const spotify = [
    'duplicate',
    ...Array.from({ length: 79 }, (_, index) => `spotify-${index}`),
  ];
  assert.equal(calls.length, 3);
  assert.deepEqual(canonicalOwnerCalls(calls).map((call) => call.bindings), [isrcs, spotify]);
  assert.match(calls[1].sql, /FROM sh_tracks/);
  assert.match(calls[2].sql, /FROM sh_track_dictionary/);
});
