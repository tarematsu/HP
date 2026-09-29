import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../database/other-migrations/049_spotify_title_artist_history_dedupe.sql', import.meta.url),
  'utf8',
);

test('Spotify history dedupe tolerates malformed and mixed-shape artist JSON', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_spotify_tracks (
      track_id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      disc_number INTEGER,
      track_number INTEGER,
      duration_ms INTEGER,
      artists_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE sh_spotify_song_identities (
      song_key TEXT PRIMARY KEY,
      canonical_track_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE sh_spotify_track_aliases (
      source_track_id TEXT PRIMARY KEY,
      song_key TEXT NOT NULL,
      canonical_track_id TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE sh_spotify_track_targets (
      track_id TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      PRIMARY KEY (track_id,artist_key)
    );
    CREATE TABLE sh_spotify_playcount_daily (
      snapshot_date TEXT NOT NULL,
      track_id TEXT NOT NULL,
      playcount INTEGER NOT NULL,
      delta INTEGER,
      collected_at INTEGER NOT NULL,
      is_carried_forward INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (snapshot_date,track_id)
    );
    CREATE TABLE sh_spotify_playcount_current (
      track_id TEXT PRIMARY KEY,
      playcount INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL,
      collected_at INTEGER NOT NULL
    );
    CREATE TABLE sh_spotify_playcount_candidates (
      snapshot_date TEXT NOT NULL,
      run_token TEXT NOT NULL,
      track_id TEXT NOT NULL,
      album_id TEXT NOT NULL,
      playcount INTEGER NOT NULL,
      collected_at INTEGER NOT NULL,
      PRIMARY KEY (snapshot_date,track_id)
    );
    CREATE TABLE sh_spotify_collection_runs (
      snapshot_date TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      run_token TEXT NOT NULL
    );
    CREATE TABLE sh_spotify_artist_daily (
      snapshot_date TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      total_delta INTEGER,
      track_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (snapshot_date,artist_key)
    );

    INSERT INTO sh_spotify_tracks VALUES
      ('canonical','album-a','mixed song',1,1,100000,
        '[{"id":"artist-a","name":"Artist A"}]',100),
      ('mixed','album-b','mixed song',1,1,101000,
        '["legacy-artist",{"id":"artist-a","name":"Artist A"}]',200),
      ('malformed','album-c','bad song',1,1,102000,
        'not-json',300);
  `);

  assert.doesNotThrow(() => db.exec(migration));

  const aliases = db.prepare(`
    SELECT source_track_id,canonical_track_id
    FROM sh_spotify_track_aliases
    ORDER BY source_track_id
  `).all().map((row) => ({ ...row }));

  assert.deepEqual(aliases, [
    { source_track_id: 'canonical', canonical_track_id: 'canonical' },
    { source_track_id: 'mixed', canonical_track_id: 'canonical' },
  ]);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS count FROM sh_spotify_track_aliases WHERE source_track_id='malformed'`).get().count,
    0,
  );
});
