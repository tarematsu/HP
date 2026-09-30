import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { spotifyPlaycountSql } from '../functions/api/spotify-playcounts.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_spotify_artist_daily (
      snapshot_date TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      total_delta INTEGER,
      PRIMARY KEY (snapshot_date, artist_key)
    );
    CREATE TABLE sh_spotify_playcount_daily (
      snapshot_date TEXT NOT NULL,
      track_id TEXT NOT NULL,
      playcount INTEGER,
      delta INTEGER,
      collected_at INTEGER,
      is_carried_forward INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (snapshot_date, track_id)
    );
    CREATE TABLE sh_spotify_track_targets (
      track_id TEXT PRIMARY KEY,
      artist_key TEXT NOT NULL
    );
    CREATE TABLE sh_spotify_tracks (
      track_id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE music_service_track_refs (
      service TEXT NOT NULL,
      source_track_id TEXT NOT NULL,
      track_id INTEGER,
      PRIMARY KEY (service, source_track_id)
    );
    INSERT INTO sh_spotify_track_targets VALUES ('sp1','sakurazaka46');
    INSERT INTO sh_spotify_tracks VALUES ('sp1','Song');
    INSERT INTO music_service_track_refs VALUES ('spotify','sp1',101);
    INSERT INTO sh_spotify_playcount_daily VALUES ('2026-09-29','sp1',100,10,1,0);
    INSERT INTO sh_spotify_playcount_daily VALUES ('2026-09-30','sp1',120,20,2,0);
    INSERT INTO sh_spotify_artist_daily VALUES ('2026-09-30','sakurazaka46',20);
  `);
  return db;
}

test('Spotify latest detail uses the artist daily summary as the normal date source', () => {
  const sql = spotifyPlaycountSql();
  assert.match(sql, /FROM sh_spotify_artist_daily summary/);
  assert.match(sql, /ORDER BY summary\.snapshot_date DESC\s+LIMIT 1/);
  assert.match(sql, /SELECT COALESCE\(/);

  const db = fixture();
  const rows = db.prepare(sql).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].snapshot_date, '2026-09-30');
  assert.equal(rows[0].track_id, 101);
  assert.equal(rows[0].playcount, 120);
});

test('Spotify latest detail retains the historical lookup only as a missing-summary fallback', () => {
  const db = fixture();
  db.exec("DELETE FROM sh_spotify_artist_daily WHERE artist_key='sakurazaka46'");

  const rows = db.prepare(spotifyPlaycountSql()).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].snapshot_date, '2026-09-30');
  assert.equal(rows[0].playcount, 120);
});
