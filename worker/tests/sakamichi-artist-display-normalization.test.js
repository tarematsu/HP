import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { ingestOptimizedBody } from '../../site/functions/lib/ingest.js';

const migration = readFileSync(
  new URL('../../database/facts-migrations/073_normalize_sakamichi_artist_display.sql', import.meta.url),
  'utf8',
);
const factsDescriptor = JSON.parse(readFileSync(
  new URL('../../database/facts-db.json', import.meta.url),
  'utf8',
));

test('track metadata ingest normalizes only known Sakamichi artist names before D1 write', async () => {
  const statements = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return { sql, values };
        },
      };
    },
    async batch(items) {
      statements.push(...items);
      return items.map(() => ({ meta: { changes: 1 } }));
    },
  };

  const result = await ingestOptimizedBody({ DB }, {
    type: 'track_metadata',
    observed_at: 100,
    data: {
      tracks: [
        {
          spotify_id: 'hinata-track',
          title: 'お願いバッハ！',
          artist: 'Hinatazaka46',
          display_title: 'お願いバッハ！ — Hinatazaka46',
          source: 'spotify_oembed',
        },
        {
          spotify_id: 'generic-track',
          title: 'Generic Song',
          artist: 'The Beatles',
          display_title: 'Generic Song — The Beatles',
          source: 'spotify_oembed',
        },
      ],
    },
  });

  assert.equal(result.tracks_written, 2);
  assert.equal(statements.length, 2);
  assert.equal(statements[0].values[2], 'お願いバッハ！');
  assert.equal(statements[0].values[3], '日向坂46');
  assert.equal(statements[0].values[4], 'お願いバッハ！ — 日向坂46');
  assert.equal(statements[1].values[3], 'The Beatles');
  assert.equal(statements[1].values[4], 'Generic Song — The Beatles');
});

function migrationDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_track_metadata (
      spotify_id TEXT PRIMARY KEY,
      isrc TEXT,
      title TEXT,
      artist TEXT,
      display_title TEXT,
      thumbnail_url TEXT,
      spotify_url TEXT,
      source TEXT,
      fetched_at INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT
    );
    CREATE TABLE sh_track_dictionary (
      isrc TEXT PRIMARY KEY,
      spotify_id TEXT,
      title TEXT,
      artist TEXT,
      thumbnail_url TEXT,
      metadata_source TEXT,
      metadata_fetched_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE sh_isrc_metadata (
      isrc TEXT PRIMARY KEY,
      title TEXT,
      artist TEXT,
      source TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      raw_json TEXT
    );
    CREATE TABLE sh_tracks (
      id INTEGER PRIMARY KEY,
      isrc TEXT,
      spotify_id TEXT,
      title TEXT,
      artist TEXT,
      last_seen_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

test('migration backfills stored source data without creating display-time fallback', () => {
  const db = migrationDatabase();
  db.exec(`
    INSERT INTO sh_track_metadata VALUES (
      'hinata-track','JPX000000001','お願いバッハ！','Hinatazaka46',
      'お願いバッハ！ — Hinatazaka46','cover',NULL,'spotify_oembed',100,'{}'
    );
    INSERT INTO sh_track_dictionary VALUES (
      'JPX000000001','hinata-track','お願いバッハ！','Hinatazaka46','cover',
      'spotify_oembed',100,100
    );
    INSERT INTO sh_isrc_metadata VALUES (
      'JPX000000001','お願いバッハ！','Hinatazaka46','spotify_oembed',100,'{}'
    );
    INSERT INTO sh_tracks VALUES (
      1,'JPX000000001','hinata-track','お願いバッハ！','Hinatazaka46',100
    );
    INSERT INTO sh_track_metadata VALUES (
      'generic-track','JPX000000002','Generic Song','The Beatles',
      'Generic Song — The Beatles','generic-cover',NULL,'spotify_oembed',100,'{}'
    );
    INSERT INTO sh_tracks VALUES (
      2,'JPX000000002','generic-track','Generic Song','The Beatles',100
    );
  `);

  db.exec(migration);

  const metadata = db.prepare(`SELECT artist,display_title FROM sh_track_metadata
    WHERE spotify_id='hinata-track'`).get();
  assert.equal(metadata.artist, '日向坂46');
  assert.equal(metadata.display_title, 'お願いバッハ！ — 日向坂46');
  assert.equal(db.prepare(`SELECT artist FROM sh_track_dictionary WHERE isrc='JPX000000001'`).get().artist, '日向坂46');
  assert.equal(db.prepare(`SELECT artist FROM sh_isrc_metadata WHERE isrc='JPX000000001'`).get().artist, '日向坂46');
  assert.equal(db.prepare(`SELECT artist FROM sh_tracks WHERE id=1`).get().artist, '日向坂46');
  assert.equal(db.prepare(`SELECT artist FROM sh_tracks WHERE id=2`).get().artist, 'The Beatles');
  assert.doesNotMatch(migration, /CREATE\s+VIEW|CREATE\s+TRIGGER/i);
});

test('MINUTE_DB registers data-source normalization as the schema tip', () => {
  const path = 'database/facts-migrations/073_normalize_sakamichi_artist_display.sql';
  assert.equal(factsDescriptor.schema, path);
  assert.equal(factsDescriptor.migrations.at(-1), path);
  assert.equal(factsDescriptor.migrations.filter((value) => value === path).length, 1);
});
