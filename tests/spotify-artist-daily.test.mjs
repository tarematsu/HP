import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  spotifyArtistDailyRefreshSql,
  spotifyTrendSql,
} from '../site/functions/api/spotify-playcounts.js';

const migration = readFileSync(
  new URL('../database/other-migrations/047_spotify_artist_daily_totals.sql', import.meta.url),
  'utf8',
);
const contract = readFileSync(
  new URL('../worker/scripts/other-db-tables.mjs', import.meta.url),
  'utf8',
);

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_spotify_playcount_daily (
      snapshot_date TEXT NOT NULL,
      track_id TEXT NOT NULL,
      playcount INTEGER NOT NULL DEFAULT 0,
      delta INTEGER,
      collected_at INTEGER NOT NULL DEFAULT 0,
      is_carried_forward INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(snapshot_date,track_id)
    ) WITHOUT ROWID;
    CREATE TABLE sh_spotify_track_targets (
      track_id TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      PRIMARY KEY(track_id,artist_key)
    ) WITHOUT ROWID;
    CREATE TABLE sh_spotify_collection_runs (
      snapshot_date TEXT PRIMARY KEY,
      status TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE sh_spotify_top20_history (
      ranking_date TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      rank INTEGER NOT NULL,
      PRIMARY KEY(ranking_date,artist_key)
    ) WITHOUT ROWID;
    CREATE TABLE sh_spotify_artists (
      artist_key TEXT PRIMARY KEY,
      artist_name TEXT NOT NULL
    ) WITHOUT ROWID;
  `);
  return db;
}

function insertDaily(db, date, track, delta) {
  db.prepare(`INSERT INTO sh_spotify_playcount_daily
    (snapshot_date,track_id,playcount,delta,collected_at,is_carried_forward)
    VALUES (?,?,100,?,1,0)`).run(date, track, delta);
}

test('Spotify artist daily migration backfills compact 90-day totals with null carry-forward days', () => {
  const db = database();
  db.exec(`
    INSERT INTO sh_spotify_track_targets VALUES
      ('track-a','sakurazaka46'),
      ('track-b','sakurazaka46'),
      ('track-b','nogizaka46');
    INSERT INTO sh_spotify_artists VALUES
      ('sakurazaka46','櫻坂46'),
      ('nogizaka46','乃木坂46');
    INSERT INTO sh_spotify_top20_history VALUES
      ('2026-09-28','sakurazaka46',10),
      ('2026-09-28','nogizaka46',8);
  `);
  insertDaily(db, '2026-09-27', 'track-a', 10);
  insertDaily(db, '2026-09-27', 'track-b', 20);
  insertDaily(db, '2026-09-28', 'track-a', null);
  insertDaily(db, '2026-09-28', 'track-b', null);

  db.exec(migration);

  assert.deepEqual(
    db.prepare(`SELECT snapshot_date,artist_key,total_delta
      FROM sh_spotify_artist_daily ORDER BY snapshot_date,artist_key`).all().map((row) => ({ ...row })),
    [
      { snapshot_date: '2026-09-27', artist_key: 'nogizaka46', total_delta: 20 },
      { snapshot_date: '2026-09-27', artist_key: 'sakurazaka46', total_delta: 30 },
      { snapshot_date: '2026-09-28', artist_key: 'nogizaka46', total_delta: null },
      { snapshot_date: '2026-09-28', artist_key: 'sakurazaka46', total_delta: null },
    ],
  );
  assert.match(contract, /'sh_spotify_artist_daily'/);
  assert.doesNotMatch(spotifyTrendSql(), /sh_spotify_playcount_daily/);
});

test('Spotify producer refresh fills every missing completed date without rescanning existing dates', () => {
  const db = database();
  db.exec(`
    INSERT INTO sh_spotify_track_targets VALUES ('track-a','sakurazaka46');
    INSERT INTO sh_spotify_artists VALUES ('sakurazaka46','櫻坂46');
    INSERT INTO sh_spotify_top20_history VALUES ('2026-09-28','sakurazaka46',10);
    INSERT INTO sh_spotify_collection_runs VALUES
      ('2026-09-27','complete'),
      ('2026-09-28','complete');
  `);
  insertDaily(db, '2026-09-27', 'track-a', 5);
  insertDaily(db, '2026-09-28', 'track-a', 7);
  db.exec(`CREATE TABLE sh_spotify_artist_daily (
    snapshot_date TEXT NOT NULL,
    artist_key TEXT NOT NULL,
    total_delta INTEGER,
    PRIMARY KEY(snapshot_date,artist_key)
  ) WITHOUT ROWID;`);
  db.prepare(`INSERT INTO sh_spotify_artist_daily VALUES (?,?,?)`)
    .run('2026-09-27', 'sakurazaka46', 5);

  const first = db.prepare(spotifyArtistDailyRefreshSql()).run();
  assert.equal(Number(first.changes), 1);
  assert.deepEqual(
    { ...db.prepare(`SELECT snapshot_date,artist_key,total_delta
      FROM sh_spotify_artist_daily WHERE snapshot_date='2026-09-28'`).get() },
    { snapshot_date: '2026-09-28', artist_key: 'sakurazaka46', total_delta: 7 },
  );

  const second = db.prepare(spotifyArtistDailyRefreshSql()).run();
  assert.equal(Number(second.changes), 0);
});
