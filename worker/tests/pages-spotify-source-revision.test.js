import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { loadVariantSourceRevision } from '../scripts/run-pages-read-model-actions.mjs';

function d1(sqlite, capturedSql) {
  return {
    prepare(sql) {
      capturedSql.push(sql);
      return {
        async first() {
          const row = sqlite.prepare(sql).get();
          return row ? { ...row } : null;
        },
      };
    },
  };
}

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sh_spotify_collection_runs (
      snapshot_date TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      run_token TEXT NOT NULL,
      tracks_collected INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE sh_spotify_top20_history (
      ranking_date TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      rank INTEGER NOT NULL,
      PRIMARY KEY (ranking_date, artist_key)
    );
    CREATE TABLE sh_spotify_artists (
      artist_key TEXT PRIMARY KEY,
      artist_name TEXT NOT NULL
    );

    INSERT INTO sh_spotify_collection_runs VALUES
      ('2026-09-27','complete','run-27',100,1000,1000),
      ('2026-09-28','queued','run-28',0,NULL,2000);

    INSERT INTO sh_spotify_artists VALUES
      ('sakurazaka46','櫻坂46'),
      ('nogizaka46','乃木坂46');

    INSERT INTO sh_spotify_top20_history VALUES
      ('2026-09-26','sakurazaka46',2),
      ('2026-09-26','nogizaka46',1),
      ('2026-09-27','sakurazaka46',1),
      ('2026-09-27','nogizaka46',2);
  `);
  return sqlite;
}

async function revision(sqlite, capturedSql = []) {
  return loadVariantSourceRevision(
    { key: 'spotify-playcounts' },
    { OTHER_DB: d1(sqlite, capturedSql) },
    Date.UTC(2026, 8, 28, 12, 0, 0),
  );
}

test('Spotify source revision is bounded to run state and the latest ranking snapshot', async () => {
  const sqlite = createDatabase();
  const capturedSql = [];
  const value = await revision(sqlite, capturedSql);

  assert.match(value, /max_snapshot_date=2026-09-27/);
  assert.match(value, /run_token=run-27/);
  assert.match(value, /tracks_collected=100/);
  assert.match(value, /ranking_date=2026-09-27/);
  assert.match(value, /ranking_signature=nogizaka46:2\|sakurazaka46:1/);
  assert.match(value, /artist_signature=nogizaka46:乃木坂46\|sakurazaka46:櫻坂46/);

  assert.equal(capturedSql.length, 1);
  assert.doesNotMatch(capturedSql[0], /sh_spotify_playcount_daily/);
  assert.doesNotMatch(capturedSql[0], /COUNT\s*\(\s*\*\s*\)/i);
  assert.match(capturedSql[0], /WHERE status='complete'/);
  assert.match(capturedSql[0], /ORDER BY snapshot_date DESC/);
  assert.match(capturedSql[0], /LIMIT 1/);
});

test('Spotify source revision changes for rank-only, artist-name, and new complete-run updates', async () => {
  const sqlite = createDatabase();
  const initial = await revision(sqlite);

  sqlite.exec(`
    UPDATE sh_spotify_top20_history
    SET rank=3
    WHERE ranking_date='2026-09-27' AND artist_key='sakurazaka46';
  `);
  const rankChanged = await revision(sqlite);
  assert.notEqual(rankChanged, initial);
  assert.match(rankChanged, /sakurazaka46:3/);

  sqlite.exec(`
    UPDATE sh_spotify_artists
    SET artist_name='櫻坂46 updated'
    WHERE artist_key='sakurazaka46';
  `);
  const artistChanged = await revision(sqlite);
  assert.notEqual(artistChanged, rankChanged);
  assert.match(artistChanged, /sakurazaka46:櫻坂46 updated/);

  sqlite.exec(`
    UPDATE sh_spotify_collection_runs
    SET status='complete',tracks_collected=105,completed_at=3000,updated_at=3000
    WHERE snapshot_date='2026-09-28';
  `);
  const runChanged = await revision(sqlite);
  assert.notEqual(runChanged, artistChanged);
  assert.match(runChanged, /max_snapshot_date=2026-09-28/);
  assert.match(runChanged, /run_token=run-28/);
  assert.match(runChanged, /tracks_collected=105/);
});
