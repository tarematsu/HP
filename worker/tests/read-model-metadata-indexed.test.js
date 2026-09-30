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
        const wanted = new Set(this.bindings);
        if (/FROM sh_tracks/.test(sql)) {
          return {
            results: db.rows
              .filter((row) => wanted.has(row.spotify_id))
              .map((row) => ({ track_id: row.track_id, spotify_id: row.spotify_id })),
          };
        }
        if (db.missing) throw new Error('no such table: sh_track_canonical_metadata');
        const key = sql.includes('WHERE track_id IN')
          ? 'track_id'
          : (sql.includes('WHERE isrc IN') ? 'isrc' : 'spotify_id');
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
  assert.equal(db.queries.length, 1);
  for (const { sql } of db.queries) {
    assert.match(sql, /FROM sh_track_canonical_metadata/);
    assert.doesNotMatch(sql, /sh_track_metadata|sh_isrc_metadata|sh_track_dictionary/);
  }
});

test('canonical track_id suppresses redundant provider alias lookups', async () => {
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
    ['JPTEST000001'],
    [7],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 7);
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0].sql, /WHERE track_id IN/);
  assert.deepEqual(db.queries[0].bindings, [7]);
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
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0].sql, /WHERE isrc IN/);
});

test('Spotify-only identities resolve through indexed sh_tracks before canonical metadata', async () => {
  const db = new CanonicalDb([{
    track_id: 12,
    spotify_id: 'sp12',
    isrc: 'JPTEST000012',
    title: 'Twelve',
    artist: 'Artist',
    thumbnail_url: 'cover-12',
    fetched_at: 30,
  }]);

  const rows = await loadReadModelTrackMetadata({ MINUTE_DB: db }, ['sp12'], []);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 12);
  assert.equal(rows[0].title, 'Twelve');
  assert.equal(db.queries.length, 2);
  assert.match(db.queries[0].sql, /FROM sh_tracks/);
  assert.match(db.queries[0].sql, /WHERE spotify_id IN/);
  assert.deepEqual(db.queries[0].bindings, ['sp12']);
  assert.match(db.queries[1].sql, /FROM sh_track_canonical_metadata/);
  assert.match(db.queries[1].sql, /WHERE track_id IN/);
  assert.deepEqual(db.queries[1].bindings, [12]);
  assert.ok(db.queries.every(({ sql }) => !/FROM sh_track_canonical_metadata[\s\S]*WHERE spotify_id IN/.test(sql)));
});

test('unknown Spotify identities retain the bounded canonical-view fallback', async () => {
  const db = new CanonicalDb();
  const rows = await loadReadModelTrackMetadata({ MINUTE_DB: db }, ['missing'], []);
  assert.deepEqual(rows, []);
  assert.equal(db.queries.length, 2);
  assert.match(db.queries[0].sql, /FROM sh_tracks/);
  assert.match(db.queries[1].sql, /FROM sh_track_canonical_metadata/);
  assert.match(db.queries[1].sql, /WHERE spotify_id IN/);
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
  assert.equal(db.queries.length, 2);
  assert.match(db.queries[0].sql, /FROM sh_tracks/);
  assert.equal(db.queries[0].bindings.length, 80);
  assert.match(db.queries[1].sql, /FROM sh_track_canonical_metadata/);
  assert.equal(db.queries[1].bindings.length, 80);
});
