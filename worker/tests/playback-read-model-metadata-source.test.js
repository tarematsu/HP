import assert from 'node:assert/strict';
import test from 'node:test';

import { loadReadModelTrackMetadata } from '../src/minute-facts-read-model.js';

function metadataDb(rows, calls, name) {
  return {
    prepare(sql) {
      calls.push({ name, sql, bindings: [] });
      const call = calls.at(-1);
      return {
        bind(...bindings) {
          call.bindings = bindings;
          return this;
        },
        async all() {
          const wanted = new Set(call.bindings);
          const key = sql.includes('WHERE isrc IN') ? 'isrc' : 'spotify_id';
          return { results: rows.filter((row) => wanted.has(row[key])) };
        },
      };
    },
  };
}

function forbiddenDb(calls) {
  return {
    prepare(sql) {
      calls.push({ name: 'buddies', sql, bindings: [] });
      throw new Error('BUDDIES_DB must not be queried for playback presentation metadata');
    },
  };
}

test('playback read-model hydration reads canonical MINUTE_DB metadata only', async () => {
  const calls = [];
  const rows = await loadReadModelTrackMetadata({
    MINUTE_DB: metadataDb([{
      track_id: 1,
      spotify_id: 'sp1',
      isrc: 'JPX1',
      title: 'Song',
      artist: 'Artist',
      thumbnail_url: 'https://img.example/cover.jpg',
      fetched_at: 20,
    }], calls, 'minute'),
    BUDDIES_DB: forbiddenDb(calls),
  }, ['sp1'], ['JPX1']);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Song');
  assert.equal(rows[0].artist, 'Artist');
  assert.equal(rows[0].thumbnail_url, 'https://img.example/cover.jpg');
  assert.deepEqual(calls.map((call) => call.name), ['minute', 'minute']);
  assert.ok(calls.every(({ sql }) => /sh_track_canonical_metadata/.test(sql)));
});

test('missing canonical metadata is not filled from BUDDIES_DB', async () => {
  const calls = [];
  const rows = await loadReadModelTrackMetadata({
    MINUTE_DB: metadataDb([{
      track_id: 1,
      spotify_id: 'sp1',
      isrc: 'JPX1',
      title: 'Song 1',
      artist: 'Artist 1',
      thumbnail_url: 'cover-1',
      fetched_at: 20,
    }], calls, 'minute'),
    BUDDIES_DB: forbiddenDb(calls),
  }, ['sp1', 'sp2'], ['JPX1', 'JPX2']);

  assert.deepEqual(rows.map((row) => row.spotify_id), ['sp1']);
  assert.deepEqual(calls.map((call) => call.name), ['minute', 'minute']);
});

test('incomplete canonical presentation remains authoritative instead of being patched by legacy cache', async () => {
  const calls = [];
  const rows = await loadReadModelTrackMetadata({
    MINUTE_DB: metadataDb([{
      track_id: 2,
      spotify_id: 'sp-bridge',
      isrc: 'JPBRIDGE1',
      title: 'Dictionary title',
      artist: 'Dictionary artist',
      thumbnail_url: null,
      fetched_at: 20,
    }], calls, 'minute'),
    BUDDIES_DB: forbiddenDb(calls),
  }, [], ['JPBRIDGE1']);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].isrc, 'JPBRIDGE1');
  assert.equal(rows[0].spotify_id, 'sp-bridge');
  assert.equal(rows[0].thumbnail_url, null);
  assert.deepEqual(calls.map(({ name }) => name), ['minute']);
});
