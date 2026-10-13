import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { spotifySongIdentityBatchStatement } from '../src/spotify-track-identity.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE sh_spotify_song_identities (
    song_key TEXT PRIMARY KEY,
    canonical_track_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const prepared = [];
  const db = { prepare(sql) {
    return { bind(...params) {
      prepared.push({ sql, params });
      return {
        async run() {
          const result = sqlite.prepare(sql).run(...params);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    } };
  } };
  const rows = () => sqlite.prepare(`SELECT song_key,canonical_track_id,created_at,updated_at
    FROM sh_spotify_song_identities ORDER BY song_key`).all().map(row => ({ ...row }));
  return { db, sqlite, rows, prepared };
}

test('one batched SQL inserts distinct song identities preserving canonical first owner', async () => {
  const { db, sqlite, rows, prepared } = fixture();
  try {
    const observedAt = Date.UTC(2026, 9, 14);
    const entries = [['song:A', 'source-1'], ['song:B', 'source-2'], ['song:C', 'source-3']];
    assert.equal((await spotifySongIdentityBatchStatement(db, entries, observedAt).run()).meta.changes, 3);
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].params.length, 4);
    assert.deepEqual(rows(), entries.map(([song_key, canonical_track_id]) => ({
      song_key, canonical_track_id, created_at: observedAt, updated_at: observedAt,
    })));
    assert.equal((await spotifySongIdentityBatchStatement(db, [['song:A', 'other-source']], observedAt + DAY_MS).run()).meta.changes, 0);
    assert.deepEqual(rows()[0], {
      song_key: 'song:A', canonical_track_id: 'source-1',
      created_at: observedAt, updated_at: observedAt,
    });
    assert.equal((await spotifySongIdentityBatchStatement(db,
      [['song:A', 'other-source'], ['song:B', 'another-source']], observedAt + 7 * DAY_MS).run()).meta.changes, 2);
    assert.deepEqual(rows().map(row => row.canonical_track_id), ['source-1', 'source-2', 'source-3']);
    assert.deepEqual(rows().map(row => row.created_at), [observedAt, observedAt, observedAt]);
    assert.deepEqual(rows().map(row => row.updated_at), [
      observedAt + 7 * DAY_MS, observedAt + 7 * DAY_MS, observedAt,
    ]);
  } finally { sqlite.close(); }
});

test('a batch containing multiple source IDs for the same song keeps the earliest source', async () => {
  const { db, sqlite, rows } = fixture();
  try {
    const time = Date.UTC(2026, 9, 14);
    const result = await spotifySongIdentityBatchStatement(db, [
      ['song:shared', 'first'], ['song:shared', 'second'],
    ], time).run();
    assert.equal(result.meta.changes, 1);
    assert.deepEqual(rows(), [{
      song_key: 'song:shared', canonical_track_id: 'first',
      created_at: time, updated_at: time,
    }]);
  } finally { sqlite.close(); }
});

test('bounded batches accept 50 keys and reject empty or oversized payloads', async () => {
  const { db, sqlite, rows } = fixture();
  try {
    const fifty = Array.from({ length: 50 }, (_, i) => [`song-${i}`, `track-${i}`]);
    assert.throws(() => spotifySongIdentityBatchStatement(db, [], 1), /1-50/);
    assert.throws(() => spotifySongIdentityBatchStatement(db, [...fifty, ['overflow', 'track']], 1), /1-50/);
    assert.equal((await spotifySongIdentityBatchStatement(db, fifty, 1).run()).meta.changes, 50);
    assert.equal(rows().length, 50);
  } finally { sqlite.close(); }
});
