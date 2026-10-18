import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { spotifyDailyAliasCleanupStatement } from '../src/spotify-playcount-daily-write.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE sh_spotify_playcount_daily (
    snapshot_date TEXT,track_id TEXT,playcount INTEGER,
    PRIMARY KEY(snapshot_date,track_id));
    CREATE TABLE sh_spotify_track_aliases (
      source_track_id TEXT PRIMARY KEY,canonical_track_id TEXT);
    INSERT INTO sh_spotify_track_aliases VALUES ('alias','canonical'),('canonical','canonical');
    INSERT INTO sh_spotify_playcount_daily VALUES
      ('2026-10-18','alias',100),('2026-10-18','canonical',100),
      ('2026-10-18','unmapped',200),('2026-10-17','alias',90);`);
  let sql;
  let bindings;
  const db = { prepare(value) {
    sql = value;
    return { bind(...values) { bindings = values; return {
      run: () => sqlite.prepare(sql).run(...bindings),
    }; } };
  } };
  const statement = spotifyDailyAliasCleanupStatement(db, '2026-10-18');
  return { sqlite, statement, sql, bindings };
}

test('daily cleanup removes only noncanonical aliases on the requested day and is idempotent', () => {
  const { sqlite, statement } = fixture();
  try {
    assert.equal(statement.run().changes, 1);
    assert.deepEqual(sqlite.prepare(`SELECT snapshot_date,track_id FROM sh_spotify_playcount_daily
      ORDER BY snapshot_date,track_id`).all().map(row => [row.snapshot_date,row.track_id]), [
      ['2026-10-17','alias'],['2026-10-18','canonical'],['2026-10-18','unmapped'],
    ]);
    assert.equal(statement.run().changes, 0);
  } finally { sqlite.close(); }
});

test('cleanup seeks the requested date and alias source ID without scanning the alias catalog', () => {
  const { sqlite, sql, bindings } = fixture();
  try {
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings)
      .map(row => row.detail).join('\n');
    assert.match(plan, /SEARCH sh_spotify_playcount_daily.*snapshot_date=/);
    assert.match(plan, /SEARCH alias.*source_track_id=/);
    assert.doesNotMatch(plan, /SCAN alias/);
  } finally { sqlite.close(); }
});
