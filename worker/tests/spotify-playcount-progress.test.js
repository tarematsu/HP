import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { updateAlbumProgress } from '../src/spotify-playcount-consumer.js';

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sh_spotify_collection_runs (
      snapshot_date TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      run_token TEXT NOT NULL,
      albums_queued INTEGER NOT NULL DEFAULT 0,
      albums_completed INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      last_error TEXT
    );
    CREATE TABLE sh_spotify_collection_album_runs (
      snapshot_date TEXT NOT NULL,
      run_token TEXT NOT NULL,
      album_id TEXT NOT NULL,
      status TEXT NOT NULL,
      track_count INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (snapshot_date, album_id)
    );
  `);
  sqlite.prepare(`INSERT INTO sh_spotify_collection_runs (
      snapshot_date,status,run_token,albums_queued,albums_completed,errors,updated_at
    ) VALUES (?,?,?,?,?,?,?)`)
    .run('2026-09-28', 'queued', 'run-1', 2, 0, 0, 1);
  return sqlite;
}

function d1(sqlite) {
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return { sql, bindings };
        },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(({ sql, bindings }) => {
          const result = sqlite.prepare(sql).run(...bindings);
          return { meta: { changes: Number(result.changes || 0) } };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function runRow(sqlite) {
  return sqlite.prepare(`SELECT albums_queued,albums_completed,errors,run_token,status
    FROM sh_spotify_collection_runs WHERE snapshot_date=?`).get('2026-09-28');
}

function albumRow(sqlite, albumId) {
  return sqlite.prepare(`SELECT run_token,status,track_count,attempts,last_error
    FROM sh_spotify_collection_album_runs WHERE snapshot_date=? AND album_id=?`)
    .get('2026-09-28', albumId);
}

test('album progress counters are idempotent across duplicate and recovered deliveries', async () => {
  const sqlite = createDatabase();
  const db = d1(sqlite);
  const albumA = { snapshot_date: '2026-09-28', run_token: 'run-1', album_id: 'album-a' };
  const albumB = { snapshot_date: '2026-09-28', run_token: 'run-1', album_id: 'album-b' };

  await updateAlbumProgress(db, albumA, { status: 'complete', trackCount: 3 }, 10);
  assert.deepEqual(runRow(sqlite), {
    albums_queued: 2,
    albums_completed: 1,
    errors: 0,
    run_token: 'run-1',
    status: 'queued',
  });
  assert.deepEqual(albumRow(sqlite, 'album-a'), {
    run_token: 'run-1', status: 'complete', track_count: 3, attempts: 1, last_error: null,
  });

  await updateAlbumProgress(db, albumA, { status: 'complete', trackCount: 3 }, 11);
  assert.equal(runRow(sqlite).albums_completed, 1);
  assert.equal(albumRow(sqlite, 'album-a').attempts, 2);

  await updateAlbumProgress(db, albumB, { status: 'error', error: new Error('temporary') }, 12);
  assert.equal(runRow(sqlite).errors, 1);
  assert.equal(albumRow(sqlite, 'album-b').status, 'error');

  await updateAlbumProgress(db, albumB, { status: 'error', error: new Error('temporary') }, 13);
  assert.equal(runRow(sqlite).errors, 1);
  assert.equal(albumRow(sqlite, 'album-b').attempts, 2);

  await updateAlbumProgress(db, albumB, { status: 'complete', trackCount: 5 }, 14);
  assert.equal(runRow(sqlite).albums_completed, 2);
  assert.equal(runRow(sqlite).errors, 0);
  assert.deepEqual(albumRow(sqlite, 'album-b'), {
    run_token: 'run-1', status: 'complete', track_count: 5, attempts: 3, last_error: null,
  });

  await updateAlbumProgress(db, albumB, { status: 'error', error: new Error('late duplicate') }, 15);
  assert.equal(runRow(sqlite).albums_completed, 2);
  assert.equal(runRow(sqlite).errors, 0);
  assert.equal(albumRow(sqlite, 'album-b').status, 'complete');
  assert.equal(albumRow(sqlite, 'album-b').attempts, 4);
});

test('stale run tokens cannot change current counters or album state', async () => {
  const sqlite = createDatabase();
  const db = d1(sqlite);
  const stale = { snapshot_date: '2026-09-28', run_token: 'old-run', album_id: 'album-a' };

  await updateAlbumProgress(db, stale, { status: 'complete', trackCount: 2 }, 20);
  assert.equal(runRow(sqlite).albums_completed, 0);
  assert.equal(runRow(sqlite).errors, 0);
  assert.equal(albumRow(sqlite, 'album-a'), undefined);
});

test('album progress no longer recounts every album row after each Queue delivery', () => {
  const source = readFileSync(new URL('../src/spotify-playcount-consumer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(
    source,
    /SELECT COUNT\(\*\) FROM sh_spotify_collection_album_runs/,
  );
  assert.match(source, /albums_completed=albums_completed\+CASE/);
  assert.match(source, /errors=MAX\(0,errors-CASE/);
});
