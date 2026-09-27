import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../database/other-migrations/045_spotify_candidate_write_reduction.sql', import.meta.url),
  'utf8',
);

const UPSERT = `INSERT INTO sh_spotify_playcount_candidates (
    snapshot_date,run_token,track_id,album_id,playcount,collected_at
  ) SELECT ?,?,?,?,?,? WHERE EXISTS (
    SELECT 1 FROM sh_spotify_collection_runs
    WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')
  ) ON CONFLICT(snapshot_date,track_id) DO UPDATE SET
    run_token=excluded.run_token,
    album_id=CASE
      WHEN sh_spotify_playcount_candidates.run_token=excluded.run_token
        AND sh_spotify_playcount_candidates.playcount>excluded.playcount
      THEN sh_spotify_playcount_candidates.album_id ELSE excluded.album_id END,
    playcount=CASE
      WHEN sh_spotify_playcount_candidates.run_token=excluded.run_token
      THEN MAX(sh_spotify_playcount_candidates.playcount,excluded.playcount)
      ELSE excluded.playcount END,
    collected_at=CASE
      WHEN sh_spotify_playcount_candidates.run_token=excluded.run_token
        AND sh_spotify_playcount_candidates.playcount>excluded.playcount
      THEN sh_spotify_playcount_candidates.collected_at
      WHEN sh_spotify_playcount_candidates.run_token=excluded.run_token
        AND sh_spotify_playcount_candidates.playcount=excluded.playcount
      THEN MAX(sh_spotify_playcount_candidates.collected_at,excluded.collected_at)
      ELSE excluded.collected_at END
  WHERE EXISTS (
    SELECT 1 FROM sh_spotify_collection_runs
    WHERE snapshot_date=? AND run_token=? AND status IN ('catalog','queued')
  )`;

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_spotify_collection_runs (
      snapshot_date TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      run_token TEXT NOT NULL
    );
    CREATE TABLE sh_spotify_playcount_candidates (
      snapshot_date TEXT NOT NULL,
      run_token TEXT NOT NULL,
      track_id TEXT NOT NULL,
      album_id TEXT NOT NULL,
      playcount INTEGER NOT NULL,
      collected_at INTEGER NOT NULL,
      PRIMARY KEY (snapshot_date, track_id)
    );
    CREATE INDEX idx_sh_spotify_candidates_run
      ON sh_spotify_playcount_candidates (snapshot_date, run_token, track_id);
    INSERT INTO sh_spotify_collection_runs VALUES ('2026-09-28','queued','run-1');
  `);
  db.exec(migration);
  return db;
}

function upsert(db, { run = 'run-1', album, count, at }) {
  return db.prepare(UPSERT).run(
    '2026-09-28', run, 'track-1', album, count, at,
    '2026-09-28', run,
    '2026-09-28', run,
  );
}

function row(db) {
  return { ...db.prepare(`SELECT run_token,album_id,playcount,collected_at
    FROM sh_spotify_playcount_candidates
    WHERE snapshot_date='2026-09-28' AND track_id='track-1'`).get() };
}

test('candidate migration removes the redundant run-token index', () => {
  const db = database();
  const indexes = db.prepare(`SELECT name FROM sqlite_master
    WHERE type='index' AND tbl_name='sh_spotify_playcount_candidates' ORDER BY name`).all()
    .map(({ name }) => name);
  assert.equal(indexes.includes('idx_sh_spotify_candidates_run'), false);
  assert.equal(indexes.some((name) => name.startsWith('sqlite_autoindex_')), true);

  const plan = db.prepare(`EXPLAIN QUERY PLAN
    SELECT track_id,playcount,collected_at
    FROM sh_spotify_playcount_candidates
    WHERE snapshot_date=? AND run_token=? ORDER BY track_id`)
    .all('2026-09-28', 'run-1')
    .map(({ detail }) => String(detail))
    .join('\n');
  assert.match(plan, /SEARCH sh_spotify_playcount_candidates/);
  assert.match(plan, /snapshot_date=\?/);
  assert.doesNotMatch(plan, /SCAN sh_spotify_playcount_candidates/);
});

test('same-run candidate retries write only when playcount advances', () => {
  const db = database();
  assert.equal(Number(upsert(db, { album: 'album-a', count: 100, at: 10 }).changes), 1);
  assert.deepEqual(row(db), {
    run_token: 'run-1', album_id: 'album-a', playcount: 100, collected_at: 10,
  });

  assert.equal(Number(upsert(db, { album: 'album-b', count: 100, at: 20 }).changes), 0);
  assert.equal(Number(upsert(db, { album: 'album-c', count: 99, at: 30 }).changes), 0);
  assert.deepEqual(row(db), {
    run_token: 'run-1', album_id: 'album-a', playcount: 100, collected_at: 10,
  });

  assert.equal(Number(upsert(db, { album: 'album-d', count: 101, at: 40 }).changes), 1);
  assert.deepEqual(row(db), {
    run_token: 'run-1', album_id: 'album-d', playcount: 101, collected_at: 40,
  });
});

test('a new run can replace a candidate even when its value is lower', () => {
  const db = database();
  upsert(db, { album: 'album-a', count: 100, at: 10 });
  db.exec(`UPDATE sh_spotify_collection_runs SET run_token='run-2' WHERE snapshot_date='2026-09-28'`);
  assert.equal(Number(upsert(db, { run: 'run-2', album: 'album-b', count: 90, at: 20 }).changes), 1);
  assert.deepEqual(row(db), {
    run_token: 'run-2', album_id: 'album-b', playcount: 90, collected_at: 20,
  });
});
