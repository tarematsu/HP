import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { spotifyTargetBatchStatement } from '../src/spotify-playcount-consumer.js';

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sh_spotify_track_targets (
      track_id TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      PRIMARY KEY (track_id, artist_key)
    );
  `);
  const seen = [];
  const db = {
    prepare(sql) {
      return {
        bind(...bindings) {
          seen.push({ sql, bindings });
          return {
            run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...bindings).changes } }),
          };
        },
      };
    },
  };
  return { sqlite, db, seen };
}
function rows(sqlite) {
  return sqlite.prepare(`SELECT track_id,artist_key FROM sh_spotify_track_targets
    ORDER BY track_id,artist_key`).all().map(row => ({ ...row }));
}

test('target artist mappings are inserted with one batched statement and no duplicates', async () => {
  const { sqlite, db, seen } = setup();
  try {
    const tracks = [
      { track_id: 't1', target_keys: ['nogizaka46', 'sakurazaka46', 'nogizaka46'] },
      { track_id: 't2', target_keys: ['sakurazaka46'] },
      { track_id: 't1', target_keys: ['nogizaka46'] },
      { track_id: 't3', target_keys: [] },
      { track_id: 't4', target_keys: ['hinatazaka46'] },
    ];
    const statement = spotifyTargetBatchStatement(db, tracks);
    assert.ok(statement);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].bindings.length, 1);
    assert.deepEqual(JSON.parse(seen[0].bindings[0]), [
      ['t1', 'nogizaka46'], ['t1', 'sakurazaka46'],
      ['t2', 'sakurazaka46'], ['t4', 'hinatazaka46'],
    ]);
    assert.equal((await statement.run()).meta.changes, 4);
    assert.deepEqual(rows(sqlite), [
      { track_id: 't1', artist_key: 'nogizaka46' },
      { track_id: 't1', artist_key: 'sakurazaka46' },
      { track_id: 't2', artist_key: 'sakurazaka46' },
      { track_id: 't4', artist_key: 'hinatazaka46' },
    ]);
    assert.equal((await spotifyTargetBatchStatement(db, tracks).run()).meta.changes, 0);
    assert.equal(rows(sqlite).length, 4);
  } finally { sqlite.close(); }
});

test('new target relationships are added for existing track IDs without losing earlier credits', async () => {
  const { sqlite, db } = setup();
  try {
    await spotifyTargetBatchStatement(db, [
      { track_id: 'shared', target_keys: ['sakurazaka46'] },
    ]).run();
    const update = spotifyTargetBatchStatement(db, [
      { track_id: 'shared', target_keys: ['sakurazaka46', 'nogizaka46'] },
    ]);
    assert.equal((await update.run()).meta.changes, 1);
    assert.deepEqual(rows(sqlite), [
      { track_id: 'shared', artist_key: 'nogizaka46' },
      { track_id: 'shared', artist_key: 'sakurazaka46' },
    ]);
  } finally { sqlite.close(); }
});

test('empty artist groups avoid an unnecessary D1 statement', () => {
  const { sqlite, db, seen } = setup();
  try {
    assert.equal(spotifyTargetBatchStatement(db, []), null);
    assert.equal(spotifyTargetBatchStatement(db, [
      { track_id: 'no-artist', target_keys: [] },
      { track_id: '', target_keys: ['sakurazaka46'] },
    ]), null);
    assert.equal(seen.length, 0);
  } finally { sqlite.close(); }
});
