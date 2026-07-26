import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { loadReadModelTrackMetadata } from '../src/read-model-metadata-indexed.js';

class MetadataDb {
  constructor({ dictionary = [], metadata = [], dictionaryMissing = false } = {}) {
    this.dictionary = dictionary;
    this.metadata = metadata;
    this.dictionaryMissing = dictionaryMissing;
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
        if (sql.includes('FROM sh_track_dictionary')) {
          if (db.dictionaryMissing) throw new Error('no such table: sh_track_dictionary');
          const wanted = new Set(this.bindings);
          return { results: db.dictionary.filter((row) => wanted.has(row.isrc)) };
        }
        if (sql.includes('INDEXED BY idx_sh_track_metadata_isrc')) {
          const wanted = new Set(this.bindings);
          return { results: db.metadata.filter((row) => wanted.has(row.isrc)) };
        }
        if (sql.includes('WHERE spotify_id IN')) {
          const wanted = new Set(this.bindings);
          return { results: db.metadata.filter((row) => wanted.has(row.spotify_id)) };
        }
        return { results: [] };
      },
    };
  }
}

function sqliteD1(db, queries) {
  return {
    prepare(sql) {
      queries.push(sql);
      const statement = db.prepare(sql);
      return {
        bind(...bindings) {
          return {
            async all() {
              return { results: statement.all(...bindings) };
            },
          };
        },
      };
    },
  };
}

test('complete dictionary rows avoid metadata scans for matching identifiers', async () => {
  const db = new MetadataDb({
    dictionary: [{
      spotify_id: 'sp1',
      isrc: 'JPTEST000001',
      title: 'Song',
      artist: 'Artist',
      thumbnail_url: 'cover',
      fetched_at: 10,
    }],
  });

  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: db },
    ['sp1'],
    ['JP-TEST-000001'],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Song');
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0].sql, /FROM sh_track_dictionary/);
  assert.doesNotMatch(db.queries[0].sql, /UNION ALL|\sOR\s/);
});

test('incomplete dictionary rows use separate indexed ISRC and Spotify lookups', async () => {
  const db = new MetadataDb({
    dictionary: [{
      spotify_id: 'sp1',
      isrc: 'JPTEST000001',
      title: 'Song',
      artist: null,
      thumbnail_url: null,
      fetched_at: 5,
    }],
    metadata: [{
      spotify_id: 'sp1',
      isrc: 'JPTEST000001',
      title: 'Song',
      artist: 'Artist',
      thumbnail_url: 'cover',
      fetched_at: 10,
    }],
  });

  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: db },
    ['sp1'],
    ['JPTEST000001'],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].artist, 'Artist');
  assert.equal(rows[0].thumbnail_url, 'cover');
  assert.equal(db.queries.length, 3);
  assert.match(db.queries[1].sql, /INDEXED BY idx_sh_track_metadata_isrc/);
  assert.match(db.queries[1].sql, /isrc IS NOT NULL AND TRIM\(isrc\)<>''/);
  assert.match(db.queries[2].sql, /WHERE spotify_id IN/);
  assert.ok(db.queries.every(({ sql }) => !/UNION ALL|\sOR\s/.test(sql)));
});

test('partial ISRC index executes without a no-query-solution planner error', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_track_dictionary(
      isrc TEXT PRIMARY KEY,spotify_id TEXT,title TEXT,artist TEXT,
      thumbnail_url TEXT,metadata_fetched_at INTEGER
    );
    CREATE TABLE sh_track_metadata(
      spotify_id TEXT PRIMARY KEY,isrc TEXT,title TEXT,artist TEXT,
      thumbnail_url TEXT,fetched_at INTEGER
    );
    CREATE INDEX idx_sh_track_metadata_isrc ON sh_track_metadata(isrc)
      WHERE isrc IS NOT NULL AND TRIM(isrc)<>'';
    INSERT INTO sh_track_metadata VALUES(
      'sp1','JPTEST000001','Song','Artist','cover',10
    );
  `);
  const queries = [];
  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: sqliteD1(db, queries) },
    [],
    ['JPTEST000001'],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].spotify_id, 'sp1');
  const indexedQuery = queries.find((sql) => sql.includes('INDEXED BY idx_sh_track_metadata_isrc'));
  assert.match(indexedQuery, /isrc IS NOT NULL AND TRIM\(isrc\)<>''/);
});

test('missing local metadata falls back only for unresolved identifiers', async () => {
  const primary = new MetadataDb({
    dictionary: [{
      spotify_id: 'complete',
      isrc: 'JPTEST000001',
      title: 'Complete',
      artist: 'Artist',
      thumbnail_url: 'cover',
      fetched_at: 10,
    }],
  });
  const fallback = new MetadataDb({
    dictionaryMissing: true,
    metadata: [{
      spotify_id: 'missing',
      isrc: 'JPTEST000002',
      title: 'Recovered',
      artist: 'Fallback',
      thumbnail_url: 'fallback-cover',
      fetched_at: 20,
    }],
  });

  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: primary, BUDDIES_DB: fallback },
    ['complete', 'missing'],
    ['JPTEST000001', 'JPTEST000002'],
  );

  assert.equal(rows.find((row) => row.spotify_id === 'complete')?.title, 'Complete');
  assert.equal(rows.find((row) => row.spotify_id === 'missing')?.title, 'Recovered');
  const fallbackBindings = fallback.queries.flatMap((query) => query.bindings);
  assert.ok(fallbackBindings.includes('missing'));
  assert.ok(fallbackBindings.includes('JPTEST000002'));
  assert.equal(fallbackBindings.includes('complete'), false);
  assert.equal(fallbackBindings.includes('JPTEST000001'), false);
});

test('loader enforces the existing eighty-key bound per identifier type', async () => {
  const db = new MetadataDb();
  const values = Array.from({ length: 100 }, (_, index) => `key-${index}`);
  await loadReadModelTrackMetadata({ MINUTE_DB: db }, values, []);
  assert.equal(db.queries.length, 1);
  assert.equal(db.queries[0].bindings.length, 80);
});
