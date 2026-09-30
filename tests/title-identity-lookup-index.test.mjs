import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(
  new URL('../database/facts-migrations/069_title_identity_lookup_indexes.sql', import.meta.url),
  'utf8',
);

function plan(db, table) {
  return db.prepare(`EXPLAIN QUERY PLAN
    SELECT title,artist
    FROM ${table}
    WHERE title IS NOT NULL AND artist IS NOT NULL
      AND TRIM(title) COLLATE NOCASE IN ('song')`).all()
    .map((row) => String(row.detail || ''))
    .join('\n');
}

test('title identity lookups seek expression indexes instead of scanning hot metadata sources', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_tracks (
      id INTEGER PRIMARY KEY,
      title TEXT,
      artist TEXT
    );
    CREATE TABLE sh_track_dictionary (
      isrc TEXT PRIMARY KEY,
      title TEXT,
      artist TEXT
    );
  `);
  db.exec(migration);

  const tracksPlan = plan(db, 'sh_tracks');
  const dictionaryPlan = plan(db, 'sh_track_dictionary');

  assert.match(tracksPlan, /USING INDEX idx_sh_tracks_title_identity/i);
  assert.match(dictionaryPlan, /USING INDEX idx_sh_track_dictionary_title_identity/i);
  assert.doesNotMatch(tracksPlan, /SCAN sh_tracks/i);
  assert.doesNotMatch(dictionaryPlan, /SCAN sh_track_dictionary/i);
});

test('title identity indexing stays limited to the observed read hotpaths', () => {
  assert.match(migration, /ON sh_tracks\(TRIM\(title\) COLLATE NOCASE\)/);
  assert.match(migration, /ON sh_track_dictionary\(TRIM\(title\) COLLATE NOCASE\)/);
  assert.doesNotMatch(migration, /ON sh_track_metadata\(/);
  assert.doesNotMatch(migration, /ON sh_isrc_metadata\(/);
});
