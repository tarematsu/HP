import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { resolveMissingSpotifyPresentation } from '../src/playback-track-metadata.js';
import {
  normalizeKnownArtistDisplayName,
  sanitizeMetadataRow,
} from '../src/track-metadata-quality.js';

const migration = readFileSync(
  new URL('../../database/facts-migrations/073_normalize_sakamichi_artist_display.sql', import.meta.url),
  'utf8',
);
const factsDescriptor = JSON.parse(readFileSync(
  new URL('../../database/facts-db.json', import.meta.url),
  'utf8',
));

test('only known Sakamichi romanizations normalize to official Japanese names', () => {
  assert.equal(normalizeKnownArtistDisplayName('Sakurazaka46'), '櫻坂46');
  assert.equal(normalizeKnownArtistDisplayName(' HINATAZAKA46 '), '日向坂46');
  assert.equal(normalizeKnownArtistDisplayName('Nogizaka 46'), '乃木坂46');
  assert.equal(normalizeKnownArtistDisplayName('The Beatles'), 'The Beatles');
});

test('live metadata sanitation normalizes Hinatazaka without changing the Japanese title', () => {
  const row = sanitizeMetadataRow({
    spotify_id: '1Y9klhaSMMI4m3bB46Rxdo',
    title: 'お願いバッハ！',
    artist: 'Hinatazaka46',
    thumbnail_url: 'https://example.test/bach.jpg',
  });
  assert.equal(row.title, 'お願いバッハ！');
  assert.equal(row.artist, '日向坂46');
});

test('stored Spotify metadata cannot reintroduce the romanized Hinatazaka artist name', async () => {
  const db = {
    prepare(sql) {
      assert.match(sql.trim(), /^SELECT spotify_id/is);
      return {
        bind() {
          return {
            async all() {
              return { results: [{
                spotify_id: '1Y9klhaSMMI4m3bB46Rxdo',
                title: 'お願いバッハ！',
                artist: 'Hinatazaka46',
                thumbnail_url: 'https://example.test/bach.jpg',
                source: 'spotify_oembed',
                fetched_at: 100,
              }] };
            },
          };
        },
      };
    },
  };

  const [row] = await resolveMissingSpotifyPresentation(db, [{
    spotify_id: '1Y9klhaSMMI4m3bB46Rxdo',
    title: 'お願いバッハ！',
    artist: null,
    thumbnail_url: 'https://example.test/bach.jpg',
  }]);
  assert.equal(row.title, 'お願いバッハ！');
  assert.equal(row.artist, '日向坂46');
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

test('migration backfills existing rows and canonical view remains defensive', () => {
  const db = migrationDatabase();
  db.exec(`
    INSERT INTO sh_track_metadata VALUES (
      '1Y9klhaSMMI4m3bB46Rxdo','JPX000000001','お願いバッハ！','Hinatazaka46',
      'お願いバッハ！ — Hinatazaka46','cover',NULL,'spotify_oembed',100,'{}'
    );
    INSERT INTO sh_track_dictionary VALUES (
      'JPX000000001','1Y9klhaSMMI4m3bB46Rxdo','お願いバッハ！','Hinatazaka46','cover',
      'spotify_oembed',100,100
    );
    INSERT INTO sh_isrc_metadata VALUES (
      'JPX000000001','お願いバッハ！','Hinatazaka46','spotify_oembed',100,'{}'
    );
    INSERT INTO sh_tracks VALUES (
      1,'JPX000000001','1Y9klhaSMMI4m3bB46Rxdo','お願いバッハ！','Hinatazaka46',100
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
    WHERE spotify_id='1Y9klhaSMMI4m3bB46Rxdo'`).get();
  assert.equal(metadata.artist, '日向坂46');
  assert.equal(metadata.display_title, 'お願いバッハ！ — 日向坂46');
  assert.equal(db.prepare(`SELECT artist FROM sh_track_dictionary WHERE isrc='JPX000000001'`).get().artist, '日向坂46');
  assert.equal(db.prepare(`SELECT artist FROM sh_isrc_metadata WHERE isrc='JPX000000001'`).get().artist, '日向坂46');
  assert.equal(db.prepare(`SELECT artist FROM sh_tracks WHERE id=1`).get().artist, '日向坂46');
  assert.equal(db.prepare(`SELECT artist FROM sh_track_canonical_metadata WHERE track_id=1`).get().artist, '日向坂46');
  assert.equal(db.prepare(`SELECT artist FROM sh_track_canonical_metadata WHERE track_id=2`).get().artist, 'The Beatles');
});

test('MINUTE_DB registers Sakamichi artist normalization as the schema tip', () => {
  const path = 'database/facts-migrations/073_normalize_sakamichi_artist_display.sql';
  assert.equal(factsDescriptor.schema, path);
  assert.equal(factsDescriptor.migrations.at(-1), path);
  assert.equal(factsDescriptor.migrations.filter((value) => value === path).length, 1);
  assert.doesNotMatch(migration, /CREATE TRIGGER/i);
});
