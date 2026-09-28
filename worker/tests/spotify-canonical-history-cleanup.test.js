import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../database/other-migrations/048_spotify_canonical_history_cleanup.sql', import.meta.url),
  'utf8',
);

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_spotify_track_targets (
      track_id TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      PRIMARY KEY (track_id,artist_key)
    );
    CREATE TABLE sh_spotify_track_aliases (
      source_track_id TEXT PRIMARY KEY,
      song_key TEXT NOT NULL,
      canonical_track_id TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
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
    CREATE TABLE sh_spotify_artist_daily (
      snapshot_date TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      total_delta INTEGER,
      track_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (snapshot_date,artist_key)
    );

    INSERT INTO sh_spotify_track_aliases VALUES
      ('source-a','song:v1:same','canonical',1,10),
      ('source-b','song:v1:same','canonical',1,10),
      ('canonical','song:v1:same','canonical',1,10),
      ('unrelated','song:v1:other','unrelated',1,10);

    INSERT INTO sh_spotify_track_targets VALUES
      ('source-a','sakurazaka46'),
      ('source-b','sakurazaka46'),
      ('unrelated','other');

    INSERT INTO sh_spotify_playcount_daily VALUES
      ('2026-09-26','source-a',100,10,1000,0),
      ('2026-09-26','source-b',110,20,1100,0),
      ('2026-09-26','canonical',105,15,1200,0),
      ('2026-09-27','source-a',130,30,2000,0),
      ('2026-09-27','source-b',140,30,2100,0),
      ('2026-09-27','canonical',135,30,2200,0),
      ('2026-09-27','unrelated',50,5,2300,0);

    INSERT INTO sh_spotify_playcount_current VALUES
      ('source-b',140,'2026-09-27',2100),
      ('canonical',135,'2026-09-27',2200),
      ('unrelated',50,'2026-09-27',2300);

    INSERT INTO sh_spotify_artist_daily VALUES
      ('2026-09-26','sakurazaka46',45,3,1200),
      ('2026-09-27','sakurazaka46',90,3,2200),
      ('2026-09-27','other',5,1,2300);
  `);
  return db;
}

function rows(db, sql) {
  return db.prepare(sql).all().map((row) => ({ ...row }));
}

test('historical Spotify aliases collapse to one canonical row per song and date', () => {
  const db = database();
  db.exec(migration);

  assert.deepEqual(rows(db, `SELECT track_id,artist_key FROM sh_spotify_track_targets ORDER BY track_id`), [
    { track_id: 'canonical', artist_key: 'sakurazaka46' },
    { track_id: 'unrelated', artist_key: 'other' },
  ]);
  assert.deepEqual(rows(db, `SELECT snapshot_date,track_id,playcount,delta
    FROM sh_spotify_playcount_daily ORDER BY snapshot_date,track_id`), [
    { snapshot_date: '2026-09-26', track_id: 'canonical', playcount: 110, delta: null },
    { snapshot_date: '2026-09-27', track_id: 'canonical', playcount: 140, delta: 30 },
    { snapshot_date: '2026-09-27', track_id: 'unrelated', playcount: 50, delta: 5 },
  ]);
  assert.deepEqual(rows(db, `SELECT track_id,playcount,snapshot_date
    FROM sh_spotify_playcount_current ORDER BY track_id`), [
    { track_id: 'canonical', playcount: 140, snapshot_date: '2026-09-27' },
    { track_id: 'unrelated', playcount: 50, snapshot_date: '2026-09-27' },
  ]);
  assert.deepEqual(rows(db, `SELECT snapshot_date,artist_key,total_delta,track_count
    FROM sh_spotify_artist_daily ORDER BY snapshot_date,artist_key`), [
    { snapshot_date: '2026-09-26', artist_key: 'sakurazaka46', total_delta: null, track_count: 1 },
    { snapshot_date: '2026-09-27', artist_key: 'other', total_delta: 5, track_count: 1 },
    { snapshot_date: '2026-09-27', artist_key: 'sakurazaka46', total_delta: 30, track_count: 1 },
  ]);
});

test('canonical history cleanup is idempotent and retains alias identity metadata', () => {
  const db = database();
  db.exec(migration);
  const onceDaily = rows(db, `SELECT snapshot_date,track_id,playcount,delta
    FROM sh_spotify_playcount_daily ORDER BY snapshot_date,track_id`);
  const onceSummary = rows(db, `SELECT snapshot_date,artist_key,total_delta,track_count
    FROM sh_spotify_artist_daily ORDER BY snapshot_date,artist_key`);

  db.exec(migration);

  assert.deepEqual(rows(db, `SELECT snapshot_date,track_id,playcount,delta
    FROM sh_spotify_playcount_daily ORDER BY snapshot_date,track_id`), onceDaily);
  assert.deepEqual(rows(db, `SELECT snapshot_date,artist_key,total_delta,track_count
    FROM sh_spotify_artist_daily ORDER BY snapshot_date,artist_key`), onceSummary);
  assert.equal(Number(db.prepare(`SELECT COUNT(*) AS count
    FROM sh_spotify_track_aliases WHERE source_track_id<>canonical_track_id`).get().count), 2);
});
