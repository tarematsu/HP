import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { spotifyArtistDailyRefreshStatements } from '../src/spotify-playcount-summary.js';

const migration = readFileSync(
  new URL('../../database/other-migrations/047_spotify_artist_daily_summary.sql', import.meta.url),
  'utf8',
);

function statement(sqlite, sql, bindings = []) {
  return {
    sql,
    bindings,
    bind(...nextBindings) {
      return statement(sqlite, sql, nextBindings);
    },
    async run() {
      const result = sqlite.prepare(sql).run(...bindings);
      return { meta: { changes: Number(result.changes || 0) } };
    },
  };
}

function d1(sqlite) {
  return {
    prepare(sql) {
      return statement(sqlite, sql);
    },
  };
}

function rows(sqlite) {
  return sqlite.prepare(`SELECT snapshot_date,artist_key,total_delta,track_count
    FROM sh_spotify_artist_daily ORDER BY snapshot_date,artist_key`).all()
    .map((row) => ({ ...row }));
}

test('Spotify artist-day migration backfills exact trend totals and preserves null delta days', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sh_spotify_playcount_daily (
      snapshot_date TEXT NOT NULL,
      track_id TEXT NOT NULL,
      playcount INTEGER NOT NULL,
      delta INTEGER,
      collected_at INTEGER NOT NULL,
      is_carried_forward INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (snapshot_date,track_id)
    );
    CREATE TABLE sh_spotify_track_targets (
      track_id TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      PRIMARY KEY (track_id,artist_key)
    );
    INSERT INTO sh_spotify_track_targets VALUES
      ('t1','artist-a'),('t1','artist-b'),('t2','artist-a');
    INSERT INTO sh_spotify_playcount_daily VALUES
      ('2026-09-27','t1',100,5,1000,0),
      ('2026-09-27','t2',200,NULL,1001,0),
      ('2026-09-28','t1',100,NULL,2000,1),
      ('2026-09-28','t2',200,NULL,2001,1);
  `);

  sqlite.exec(migration);
  assert.deepEqual(rows(sqlite), [
    { snapshot_date: '2026-09-27', artist_key: 'artist-a', total_delta: 5, track_count: 2 },
    { snapshot_date: '2026-09-27', artist_key: 'artist-b', total_delta: 5, track_count: 1 },
    { snapshot_date: '2026-09-28', artist_key: 'artist-a', total_delta: null, track_count: 2 },
    { snapshot_date: '2026-09-28', artist_key: 'artist-b', total_delta: null, track_count: 1 },
  ]);

  sqlite.exec(`
    DELETE FROM sh_spotify_track_targets WHERE artist_key='artist-b';
    UPDATE sh_spotify_playcount_daily
    SET delta=7,collected_at=3000
    WHERE snapshot_date='2026-09-27' AND track_id='t1';
  `);
  const refresh = spotifyArtistDailyRefreshStatements(d1(sqlite), '2026-09-27', 4000);
  assert.equal(refresh.length, 2);
  assert.match(refresh[0].sql, /DELETE FROM sh_spotify_artist_daily WHERE snapshot_date=\?/);
  assert.match(refresh[1].sql, /WHERE d\.snapshot_date=\?/);
  for (const item of refresh) await item.run();

  assert.deepEqual(rows(sqlite), [
    { snapshot_date: '2026-09-27', artist_key: 'artist-a', total_delta: 7, track_count: 2 },
    { snapshot_date: '2026-09-28', artist_key: 'artist-a', total_delta: null, track_count: 2 },
    { snapshot_date: '2026-09-28', artist_key: 'artist-b', total_delta: null, track_count: 1 },
  ]);
});
