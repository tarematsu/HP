import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  attachReadModelTrackMetadata,
  loadReadModelTrackMetadata,
} from '../src/minute-facts-read-model.js';

const migration = await readFile(
  new URL('../../database/facts-migrations/020_isrc_track_dictionary.sql', import.meta.url),
  'utf8',
);
const canonicalMigration = await readFile(
  new URL('../../database/facts-migrations/061_canonical_track_metadata_read_model.sql', import.meta.url),
  'utf8',
);

test('ISRC dictionary migration materializes metadata but derives latest bite stats', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_track_dictionary/);
  assert.match(migration, /isrc TEXT PRIMARY KEY/);
  assert.match(migration, /thumbnail_url TEXT/);
  assert.match(migration, /trg_sh_track_dictionary_metadata_insert/);
  assert.match(migration, /trg_sh_track_dictionary_isrc_metadata_insert/);
  assert.match(migration, /CREATE VIEW sh_track_stats_by_isrc/);
  assert.match(migration, /FROM sh_track_counter_current AS current/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS sh_track_stats_by_isrc/);
});

test('canonical migration exposes presentation metadata as a view without another stored copy', () => {
  assert.match(canonicalMigration, /CREATE VIEW sh_track_canonical_metadata/);
  assert.match(canonicalMigration, /FROM sh_tracks AS t/);
  assert.match(canonicalMigration, /LEFT JOIN sh_track_dictionary AS d/);
  assert.doesNotMatch(canonicalMigration, /CREATE TABLE IF NOT EXISTS sh_track_canonical_metadata/);
});

test('minute metadata hydration reads only the canonical track metadata view', async () => {
  const statements = [];
  const MINUTE_DB = {
    prepare(sql) {
      statements.push(sql);
      return {
        bindings: [],
        bind(...values) {
          this.bindings = values;
          return this;
        },
        async all() {
          const wanted = new Set(this.bindings);
          return {
            results: wanted.has('USABC1234567') || wanted.has('new-sp') ? [{
              track_id: 10,
              spotify_id: 'old-sp',
              isrc: 'USABC1234567',
              title: 'Song',
              artist: 'Artist',
              thumbnail_url: 'cover',
              fetched_at: 10,
            }] : [],
          };
        },
      };
    },
  };

  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB },
    ['new-sp'],
    ['USABC1234567'],
  );
  assert.equal(rows.length, 1);
  assert.ok(statements.every((sql) => /FROM sh_track_canonical_metadata/.test(sql)));
  assert.ok(statements.every((sql) => !/sh_track_metadata|sh_isrc_metadata|sh_track_dictionary/.test(sql)));

  const hydrated = attachReadModelTrackMetadata({
    tracks: [{
      spotify_id: 'new-sp',
      isrc: 'US-ABC-12-34567',
      title: null,
      artist: null,
      thumbnail_url: null,
    }],
  }, rows);
  assert.equal(hydrated.tracks[0].title, 'Song');
  assert.equal(hydrated.tracks[0].thumbnail_url, 'cover');
});

test('missing canonical view does not fall back to source metadata tables', async () => {
  const statements = [];
  const MINUTE_DB = {
    prepare(sql) {
      statements.push(sql);
      return {
        bind() { return this; },
        async all() {
          throw new Error('no such table: sh_track_canonical_metadata');
        },
      };
    },
  };

  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB },
    ['sp1'],
    ['USABC1234567'],
  );
  assert.deepEqual(rows, []);
  assert.ok(statements.every((sql) => /sh_track_canonical_metadata/.test(sql)));
});
