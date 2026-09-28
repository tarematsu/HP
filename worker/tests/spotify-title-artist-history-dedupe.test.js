import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../database/other-migrations/049_spotify_title_artist_history_dedupe.sql', import.meta.url),
  'utf8',
);

function database() {
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
      ('canonical-a','single-a','自業自得',1,1,198000,
        '[{"id":"artist-a","name":"櫻坂46"},{"id":"guest-b","name":"Guest"}]',100),
      ('variant-b','album-b','自業自得',1,4,204000,
        '[{"id":"guest-b","name":"Guest"},{"id":"artist-a","name":"櫻坂46"}]',200),
      ('live-c','live-c','自業自得 - Live',1,1,198000,
        '[{"id":"artist-a","name":"櫻坂46"},{"id":"guest-b","name":"Guest"}]',300),
      ('other-d','other-d','自業自得',1,1,198000,
        '[{"id":"artist-z","name":"別アーティスト"}]',400);

    INSERT INTO sh_spotify_song_identities VALUES
      ('song:v1:自業自得' || char(31) || 'artist-a,guest-b' || char(31) || '198','canonical-a',10,100),
      ('song:v1:自業自得' || char(31) || 'artist-a,guest-b' || char(31) || '204','variant-b',20,200),
      ('song:v1:自業自得 - live' || char(31) || 'artist-a,guest-b' || char(31) || '198','live-c',30,300),
      ('song:v1:自業自得' || char(31) || 'artist-z' || char(31) || '198','other-d',40,400);

    INSERT INTO sh_spotify_track_aliases VALUES
      ('canonical-a','old-a','canonical-a',10,100),
      ('variant-b','old-b','variant-b',20,200),
      ('live-c','old-live','live-c',30,300),
      ('other-d','old-other','other-d',40,400);

    INSERT INTO sh_spotify_track_targets VALUES
      ('canonical-a','sakurazaka46'),
      ('variant-b','sakurazaka46'),
      ('live-c','sakurazaka46'),
      ('other-d','other');

    INSERT INTO sh_spotify_playcount_daily VALUES
      ('2026-09-26','canonical-a',100,10,1000,0),
      ('2026-09-26','variant-b',110,20,1100,0),
      ('2026-09-26','live-c',50,5,1200,0),
      ('2026-09-26','other-d',80,8,1300,0),
      ('2026-09-27','canonical-a',130,30,2000,0),
      ('2026-09-27','variant-b',140,30,2100,0),
      ('2026-09-27','live-c',60,10,2200,0),
      ('2026-09-27','other-d',90,10,2300,0);

    INSERT INTO sh_spotify_playcount_current VALUES
      ('canonical-a',130,'2026-09-27',2000),
      ('variant-b',140,'2026-09-27',2100),
      ('live-c',60,'2026-09-27',2200),
      ('other-d',90,'2026-09-27',2300);

    INSERT INTO sh_spotify_collection_runs VALUES
      ('2026-09-28','queued','active-run');
    INSERT INTO sh_spotify_playcount_candidates VALUES
      ('2026-09-28','active-run','canonical-a','single-a',150,3000),
      ('2026-09-28','active-run','variant-b','album-b',160,3100);

    INSERT INTO sh_spotify_artist_daily VALUES
      ('2026-09-26','sakurazaka46',35,3,1200),
      ('2026-09-27','sakurazaka46',70,3,2200),
      ('2026-09-26','other',8,1,1300),
      ('2026-09-27','other',10,1,2300);
  `);
  return db;
}

function rows(db, sql) {
  return db.prepare(sql).all().map((row) => ({ ...row }));
}

test('historical Spotify rows with the same title and credited artists collapse despite duration differences', () => {
  const db = database();
  db.exec(migration);

  assert.deepEqual(rows(db, `SELECT snapshot_date,track_id,playcount,delta
    FROM sh_spotify_playcount_daily ORDER BY snapshot_date,track_id`), [
    { snapshot_date: '2026-09-26', track_id: 'canonical-a', playcount: 110, delta: null },
    { snapshot_date: '2026-09-26', track_id: 'live-c', playcount: 50, delta: 5 },
    { snapshot_date: '2026-09-26', track_id: 'other-d', playcount: 80, delta: 8 },
    { snapshot_date: '2026-09-27', track_id: 'canonical-a', playcount: 140, delta: 30 },
    { snapshot_date: '2026-09-27', track_id: 'live-c', playcount: 60, delta: 10 },
    { snapshot_date: '2026-09-27', track_id: 'other-d', playcount: 90, delta: 10 },
  ]);

  assert.deepEqual(rows(db, `SELECT track_id,artist_key FROM sh_spotify_track_targets ORDER BY track_id,artist_key`), [
    { track_id: 'canonical-a', artist_key: 'sakurazaka46' },
    { track_id: 'live-c', artist_key: 'sakurazaka46' },
    { track_id: 'other-d', artist_key: 'other' },
  ]);

  assert.deepEqual(rows(db, `SELECT source_track_id,canonical_track_id
    FROM sh_spotify_track_aliases ORDER BY source_track_id`), [
    { source_track_id: 'canonical-a', canonical_track_id: 'canonical-a' },
    { source_track_id: 'live-c', canonical_track_id: 'live-c' },
    { source_track_id: 'other-d', canonical_track_id: 'other-d' },
    { source_track_id: 'variant-b', canonical_track_id: 'canonical-a' },
  ]);

  assert.deepEqual(rows(db, `SELECT snapshot_date,artist_key,total_delta,track_count
    FROM sh_spotify_artist_daily ORDER BY snapshot_date,artist_key`), [
    { snapshot_date: '2026-09-26', artist_key: 'other', total_delta: 8, track_count: 1 },
    { snapshot_date: '2026-09-26', artist_key: 'sakurazaka46', total_delta: 5, track_count: 2 },
    { snapshot_date: '2026-09-27', artist_key: 'other', total_delta: 10, track_count: 1 },
    { snapshot_date: '2026-09-27', artist_key: 'sakurazaka46', total_delta: 40, track_count: 2 },
  ]);

  assert.deepEqual(rows(db, `SELECT track_id,playcount,snapshot_date
    FROM sh_spotify_playcount_current ORDER BY track_id`), [
    { track_id: 'canonical-a', playcount: 140, snapshot_date: '2026-09-27' },
    { track_id: 'live-c', playcount: 60, snapshot_date: '2026-09-27' },
    { track_id: 'other-d', playcount: 90, snapshot_date: '2026-09-27' },
  ]);

  assert.deepEqual(rows(db, `SELECT track_id,playcount,run_token
    FROM sh_spotify_playcount_candidates ORDER BY track_id`), [
    { track_id: 'canonical-a', playcount: 160, run_token: 'active-run' },
  ]);
});

test('historical title cleanup matches credited artist order but preserves different artists and named versions', () => {
  const db = database();
  db.exec(migration);

  const key = db.prepare(`SELECT song_key,canonical_track_id
    FROM sh_spotify_track_aliases WHERE source_track_id='variant-b'`).get();
  assert.equal(key.canonical_track_id, 'canonical-a');
  assert.equal(key.song_key, `song:v1:自業自得\u001fartist-a,guest-b`);

  assert.equal(
    db.prepare(`SELECT canonical_track_id FROM sh_spotify_track_aliases WHERE source_track_id='live-c'`).get().canonical_track_id,
    'live-c',
  );
  assert.equal(
    db.prepare(`SELECT canonical_track_id FROM sh_spotify_track_aliases WHERE source_track_id='other-d'`).get().canonical_track_id,
    'other-d',
  );
});

test('historical Spotify title cleanup is idempotent', () => {
  const db = database();
  db.exec(migration);
  const onceDaily = rows(db, `SELECT snapshot_date,track_id,playcount,delta
    FROM sh_spotify_playcount_daily ORDER BY snapshot_date,track_id`);
  const onceSummary = rows(db, `SELECT snapshot_date,artist_key,total_delta,track_count
    FROM sh_spotify_artist_daily ORDER BY snapshot_date,artist_key`);
  const onceCandidates = rows(db, `SELECT snapshot_date,track_id,playcount,run_token
    FROM sh_spotify_playcount_candidates ORDER BY snapshot_date,track_id`);

  db.exec(migration);

  assert.deepEqual(rows(db, `SELECT snapshot_date,track_id,playcount,delta
    FROM sh_spotify_playcount_daily ORDER BY snapshot_date,track_id`), onceDaily);
  assert.deepEqual(rows(db, `SELECT snapshot_date,artist_key,total_delta,track_count
    FROM sh_spotify_artist_daily ORDER BY snapshot_date,artist_key`), onceSummary);
  assert.deepEqual(rows(db, `SELECT snapshot_date,track_id,playcount,run_token
    FROM sh_spotify_playcount_candidates ORDER BY snapshot_date,track_id`), onceCandidates);
});
