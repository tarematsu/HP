import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  SPOTIFY_CANDIDATE_CHUNK_SIZE,
  spotifyCandidateBatchStatement,
} from '../src/spotify-playcount-consumer.js';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sh_spotify_collection_runs (
      snapshot_date TEXT PRIMARY KEY,
      run_token TEXT NOT NULL,
      status TEXT NOT NULL
    );
    INSERT INTO sh_spotify_collection_runs VALUES ('2026-10-14','run-1','queued');
    CREATE TABLE sh_spotify_playcount_candidates (
      snapshot_date TEXT NOT NULL,
      run_token TEXT NOT NULL,
      track_id TEXT NOT NULL,
      album_id TEXT NOT NULL,
      playcount INTEGER NOT NULL,
      collected_at INTEGER NOT NULL,
      PRIMARY KEY (snapshot_date,track_id)
    );
  `);
  let sql;
  let bindings;
  const d1 = {
    prepare(value) {
      sql = value;
      return {
        bind(...values) {
          bindings = values;
          return {
            run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
          };
        },
      };
    },
  };
  return {
    sqlite,
    d1,
    statement() { return { sql, bindings }; },
    rows() {
      return sqlite.prepare('SELECT run_token,track_id,album_id,playcount,collected_at FROM sh_spotify_playcount_candidates ORDER BY track_id')
        .all().map((row) => ({ ...row }));
    },
  };
}

test('a candidate batch preserves per-track winners and ordering, with one active-run guard', async () => {
  const { sqlite, d1, rows, statement } = setup();
  try {
    const message = { snapshot_date: '2026-10-14', run_token: 'run-1', album_id: 'album-a' };
    let result = await spotifyCandidateBatchStatement(d1, message, [
      { track_id: 'shared', playcount: 120 },
      { track_id: 'other', playcount: 15 },
      { track_id: 'shared', playcount: 125 },
    ], 1000).run();
    assert.equal(result.meta.changes, 3);
    const { sql, bindings } = statement();
    assert.equal(bindings.length, 7, 'one active-run lookup for the whole JSON array');
    assert.equal((sql.match(/FROM sh_spotify_collection_runs/g) || []).length, 1);
    assert.deepEqual(rows(), [
      { track_id: 'other', album_id: 'album-a', run_token: 'run-1', playcount: 15, collected_at: 1000 },
      { track_id: 'shared', album_id: 'album-a', run_token: 'run-1', playcount: 125, collected_at: 1000 },
    ]);
    result = await spotifyCandidateBatchStatement(d1, {
      ...message, album_id: 'album-b',
    }, [{ track_id: 'shared', playcount: 90 }, { track_id: 'other', playcount: 15 }], 2000).run();
    assert.equal(result.meta.changes, 1, 'lower score ignored, equal score keeps new timestamp');
    assert.equal(rows()[1].album_id, 'album-a');
    assert.equal(rows()[1].playcount, 125);
    assert.equal(rows()[0].collected_at, 2000);
    assert.equal((await spotifyCandidateBatchStatement(d1, message,
      [{ track_id: 'shared', playcount: 125 }], 1000).run()).meta.changes, 0);
  } finally { sqlite.close(); }
});

test('batch guard blocks completed and old attempts but replacement runs can lower scores', async () => {
  const { sqlite, d1, rows } = setup();
  try {
    const message = { snapshot_date: '2026-10-14', run_token: 'run-1', album_id: 'album-a' };
    const tracks = [{ track_id: 'shared', playcount: 100 }, { track_id: 'new', playcount: 50 }];
    assert.equal((await spotifyCandidateBatchStatement(d1, message, tracks, 1000).run()).meta.changes, 2);

    sqlite.exec("UPDATE sh_spotify_collection_runs SET status='complete'");
    assert.equal((await spotifyCandidateBatchStatement(d1, message,
      [{ track_id: 'shared', playcount: 400 }, { track_id: 'other', playcount: 20 }], 2000).run()).meta.changes, 0);
    assert.equal(rows().length, 2);
    sqlite.exec("UPDATE sh_spotify_collection_runs SET status='queued',run_token='run-2'");
    assert.equal((await spotifyCandidateBatchStatement(d1, message,
      [{ track_id: 'shared', playcount: 400 }], 3000).run()).meta.changes, 0);
    assert.equal((await spotifyCandidateBatchStatement(d1, {
      ...message, run_token: 'run-2', album_id: 'album-new',
    }, [{ track_id: 'shared', playcount: 80 }], 4000).run()).meta.changes, 1);
    assert.deepEqual(rows().find(row => row.track_id === 'shared'), {
      run_token: 'run-2', track_id: 'shared', album_id: 'album-new', playcount: 80, collected_at: 4000,
    });
  } finally { sqlite.close(); }
});

test('batch size bound prevents unexpectedly large JSON statements', () => {
  const { sqlite, d1 } = setup();
  try {
    const message = { snapshot_date: '2026-10-14', run_token: 'run-1', album_id: 'album-a' };
    const tracks = Array.from({ length: SPOTIFY_CANDIDATE_CHUNK_SIZE + 1 }, (_, index) => ({
      track_id: `track-${index}`, playcount: index,
    }));
    assert.equal(SPOTIFY_CANDIDATE_CHUNK_SIZE, 40);
    assert.throws(() => spotifyCandidateBatchStatement(d1, message, []), /1-40 tracks/);
    assert.throws(() => spotifyCandidateBatchStatement(d1, message, tracks, 1000), /1-40 tracks/);
  } finally { sqlite.close(); }
});
