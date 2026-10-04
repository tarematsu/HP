import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../database/facts-migrations/072_spotify_presentation_authority.sql', import.meta.url),
  'utf8',
);
const factsDescriptor = JSON.parse(readFileSync(
  new URL('../database/facts-db.json', import.meta.url),
  'utf8',
));

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
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
    CREATE INDEX idx_sh_track_dictionary_spotify
      ON sh_track_dictionary(spotify_id);
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
  `);
  return db;
}

test('migration replaces provisional romanization by spotify_id even when Spotify metadata has no ISRC', () => {
  const db = database();
  db.exec(`
    INSERT INTO sh_track_dictionary VALUES (
      'JPX000000001','7BuovmQKMWGIsxWPcYOWqu',
      'Jisho Ballet Dancer','Sakurazaka46','stationhead-cover',
      'stationhead_queue',100,100
    );
    INSERT INTO sh_track_metadata VALUES (
      '7BuovmQKMWGIsxWPcYOWqu',NULL,
      '自称バレエダンサー','櫻坂46','自称バレエダンサー — 櫻坂46','spotify-cover',
      'https://open.spotify.com/track/7BuovmQKMWGIsxWPcYOWqu',
      'spotify_oembed',200,'{}'
    );
  `);

  db.exec(migration);
  const row = db.prepare(`SELECT title,artist,thumbnail_url,metadata_source,metadata_fetched_at
    FROM sh_track_dictionary WHERE spotify_id=?`).get('7BuovmQKMWGIsxWPcYOWqu');
  assert.deepEqual({ ...row }, {
    title: '自称バレエダンサー',
    artist: '櫻坂46',
    thumbnail_url: 'spotify-cover',
    metadata_source: 'spotify_oembed',
    metadata_fetched_at: 200,
  });
});

test('newer Spotify localization replaces an older value from the same authoritative source', () => {
  const db = database();
  db.exec(`
    INSERT INTO sh_track_dictionary VALUES (
      'JPX000000002','spotify-new-release',
      'Jisho Ballet Dancer','Sakurazaka46','cover-old',
      'spotify_oembed',100,100
    );
  `);
  db.exec(migration);

  db.prepare(`INSERT INTO sh_track_metadata(
      spotify_id,isrc,title,artist,display_title,thumbnail_url,spotify_url,source,fetched_at,raw_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    'spotify-new-release', null,
    '自称バレエダンサー', '櫻坂46', '自称バレエダンサー — 櫻坂46', 'cover-new',
    'https://open.spotify.com/track/spotify-new-release', 'spotify_oembed', 200, '{}',
  );

  const row = db.prepare(`SELECT title,artist,thumbnail_url,metadata_source,metadata_fetched_at
    FROM sh_track_dictionary WHERE spotify_id=?`).get('spotify-new-release');
  assert.equal(row.title, '自称バレエダンサー');
  assert.equal(row.artist, '櫻坂46');
  assert.equal(row.thumbnail_url, 'cover-new');
  assert.equal(row.metadata_source, 'spotify_oembed');
  assert.equal(row.metadata_fetched_at, 200);
});

test('manual higher-priority presentation is not overwritten by Spotify metadata', () => {
  const db = database();
  db.exec(`
    INSERT INTO sh_track_dictionary VALUES (
      'JPX000000003','manual-track','手動タイトル','手動アーティスト','manual-cover',
      'manual',500,500
    );
  `);
  db.exec(migration);
  db.prepare(`INSERT INTO sh_track_metadata(
      spotify_id,isrc,title,artist,display_title,thumbnail_url,spotify_url,source,fetched_at,raw_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    'manual-track', null, 'Spotify Title', 'Spotify Artist', null, 'spotify-cover', null,
    'spotify_oembed', 600, '{}',
  );
  const row = db.prepare(`SELECT title,artist,thumbnail_url,metadata_source
    FROM sh_track_dictionary WHERE spotify_id=?`).get('manual-track');
  assert.deepEqual({ ...row }, {
    title: '手動タイトル',
    artist: '手動アーティスト',
    thumbnail_url: 'manual-cover',
    metadata_source: 'manual',
  });
});

test('MINUTE_DB still registers Spotify presentation authority before newer migrations', () => {
  const path = 'database/facts-migrations/072_spotify_presentation_authority.sql';
  assert.equal(factsDescriptor.migrations.filter((value) => value === path).length, 1);
  assert.ok(factsDescriptor.migrations.indexOf(path) < factsDescriptor.migrations.length - 1);
});
