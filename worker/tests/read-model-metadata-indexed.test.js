import assert from 'node:assert/strict';
import test from 'node:test';

import { loadReadModelTrackMetadata } from '../src/read-model-metadata-indexed.js';

class CanonicalDb {
  constructor(rows = [], { missing = false } = {}) {
    this.rows = rows;
    this.missing = missing;
    this.queries = [];
  }

  prepare(sql) {
    const db = this;
    return {
      bindings: [],
      bind(...bindings) {
        this.bindings = bindings;
        return this;
      },
      async all() {
        db.queries.push({ sql, bindings: this.bindings });
        if (db.missing) throw new Error('no such table: sh_track_canonical_metadata');
        const wanted = new Set(this.bindings);
        const key = sql.includes('WHERE isrc IN') ? 'isrc' : 'spotify_id';
        return { results: db.rows.filter((row) => wanted.has(row[key])) };
      },
    };
  }
}

test('loader reads presentation metadata only from the canonical MINUTE_DB view', async () => {
  const db = new CanonicalDb([{
    track_id: 7,
    spotify_id: 'sp1',
    isrc: 'JPTEST000001',
    title: 'Song',
    artist: 'Artist',
    thumbnail_url: 'cover',
    fetched_at: 10,
  }]);

  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: db },
    ['sp1'],
    ['JP-TEST-000001'],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 7);
  assert.equal(rows[0].title, 'Song');
  assert.equal(db.queries.length, 2);
  for (const { sql } of db.queries) {
    assert.match(sql, /FROM sh_track_canonical_metadata/);
    assert.doesNotMatch(sql, /sh_track_metadata|sh_isrc_metadata|sh_track_dictionary/);
  }
});

test('same canonical track returned by ISRC and Spotify lookup is deduplicated by track_id', async () => {
  const db = new CanonicalDb([{
    track_id: 9,
    spotify_id: 'sp9',
    isrc: 'JPTEST000009',
    title: 'Nine',
    artist: 'Artist',
    thumbnail_url: 'cover-9',
    fetched_at: 20,
  }]);

  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: db },
    ['sp9'],
    ['JPTEST000009'],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 9);
});

test('BUDDIES metadata is not blended into unresolved canonical metadata', async () => {
  const primary = new CanonicalDb([{
    track_id: 1,
    spotify_id: 'complete',
    isrc: 'JPTEST000001',
    title: 'Complete',
    artist: 'Artist',
    thumbnail_url: 'cover',
    fetched_at: 10,
  }]);
  const fallback = {
    prepare() {
      throw new Error('BUDDIES_DB must not be queried by canonical metadata loader');
    },
  };

  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: primary, BUDDIES_DB: fallback },
    ['complete', 'missing'],
    ['JPTEST000001', 'JPTEST000002'],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].spotify_id, 'complete');
});

test('missing canonical view degrades to no metadata instead of reading a source cache', async () => {
  const db = new CanonicalDb([], { missing: true });
  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: db },
    ['sp1'],
    ['JPTEST000001'],
  );
  assert.deepEqual(rows, []);
  assert.ok(db.queries.every(({ sql }) => sql.includes('sh_track_canonical_metadata')));
});

test('loader enforces the existing eighty-key bound per identifier type', async () => {
  const db = new CanonicalDb();
  const values = Array.from({ length: 100 }, (_, index) => `key-${index}`);
  await loadReadModelTrackMetadata({ MINUTE_DB: db }, values, []);
  assert.equal(db.queries.length, 1);
  assert.equal(db.queries[0].bindings.length, 80);
});
