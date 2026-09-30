import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { spotifyArtistDailyRefreshStatements } from '../src/spotify-playcount-summary.js';

const migration = readFileSync(
  new URL('../../database/other-migrations/047_spotify_artist_daily_summary.sql', import.meta.url),
  'utf8',
);
const top10Migration = readFileSync(
  new URL('../../database/other-migrations/050_spotify_artist_top10_daily.sql', import.meta.url),
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

function createSpotifySchema(sqlite) {
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
    CREATE TABLE sh_spotify_tracks (
      track_id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE sh_spotify_releases (
      album_id TEXT PRIMARY KEY,
      release_date TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE sh_spotify_track_aliases (
      source_track_id TEXT PRIMARY KEY,
      canonical_track_id TEXT NOT NULL
    );
  `);
}

function rows(sqlite) {
  return sqlite.prepare(`SELECT
      snapshot_date,artist_key,total_delta,track_count,top10_delta,top10_year_delta
    FROM sh_spotify_artist_daily ORDER BY snapshot_date,artist_key`).all()
    .map((row) => ({ ...row }));
}

test('Spotify artist-day migrations backfill total and top-10 trend metrics', async () => {
  const sqlite = new DatabaseSync(':memory:');
  createSpotifySchema(sqlite);
  sqlite.exec(`
    INSERT INTO sh_spotify_releases VALUES
      ('release-2026','2026-01-01'),('release-2025','2025-01-01');
    INSERT INTO sh_spotify_tracks VALUES
      ('t1','release-2026','Song 1'),('t2','release-2025','Song 2');
    INSERT INTO sh_spotify_track_targets VALUES
      ('t1','artist-a'),('t1','artist-b'),('t2','artist-a');
    INSERT INTO sh_spotify_playcount_daily VALUES
      ('2026-09-27','t1',100,5,1000,0),
      ('2026-09-27','t2',200,NULL,1001,0),
      ('2026-09-28','t1',100,NULL,2000,1),
      ('2026-09-28','t2',200,NULL,2001,1);
  `);

  sqlite.exec(migration);
  sqlite.exec(top10Migration);
  assert.deepEqual(rows(sqlite), [
    { snapshot_date: '2026-09-27', artist_key: 'artist-a', total_delta: 5, track_count: 2, top10_delta: 5, top10_year_delta: 5 },
    { snapshot_date: '2026-09-27', artist_key: 'artist-b', total_delta: 5, track_count: 1, top10_delta: 5, top10_year_delta: 5 },
    { snapshot_date: '2026-09-28', artist_key: 'artist-a', total_delta: null, track_count: 2, top10_delta: null, top10_year_delta: null },
    { snapshot_date: '2026-09-28', artist_key: 'artist-b', total_delta: null, track_count: 1, top10_delta: null, top10_year_delta: null },
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
  assert.match(refresh[1].sql, /ROW_NUMBER\(\) OVER/);
  assert.match(refresh[1].sql, /top10_year_delta/);
  for (const item of refresh) await item.run();

  assert.deepEqual(rows(sqlite), [
    { snapshot_date: '2026-09-27', artist_key: 'artist-a', total_delta: 7, track_count: 2, top10_delta: 7, top10_year_delta: 7 },
    { snapshot_date: '2026-09-28', artist_key: 'artist-a', total_delta: null, track_count: 2, top10_delta: null, top10_year_delta: null },
    { snapshot_date: '2026-09-28', artist_key: 'artist-b', total_delta: null, track_count: 1, top10_delta: null, top10_year_delta: null },
  ]);
});

test('Spotify artist-day summary keeps only the ten largest deltas and filters current-year releases', () => {
  const sqlite = new DatabaseSync(':memory:');
  createSpotifySchema(sqlite);
  sqlite.exec(`
    INSERT INTO sh_spotify_releases VALUES
      ('release-2026','2026-02-01'),('release-2025','2025-02-01');
  `);
  const insertTrack = sqlite.prepare('INSERT INTO sh_spotify_tracks VALUES (?,?,?)');
  const insertTarget = sqlite.prepare('INSERT INTO sh_spotify_track_targets VALUES (?,?)');
  const insertDaily = sqlite.prepare('INSERT INTO sh_spotify_playcount_daily VALUES (?,?,?,?,?,0)');
  for (let index = 1; index <= 12; index += 1) {
    const trackId = `t${index}`;
    insertTrack.run(trackId, index <= 6 ? 'release-2026' : 'release-2025', `Song ${index}`);
    insertTarget.run(trackId, 'artist-a');
    insertDaily.run('2026-09-28', trackId, 1000 + index, index, 2000 + index);
  }

  sqlite.exec(migration);
  sqlite.exec(top10Migration);
  assert.deepEqual(rows(sqlite), [
    {
      snapshot_date: '2026-09-28',
      artist_key: 'artist-a',
      total_delta: 78,
      track_count: 12,
      top10_delta: 75,
      top10_year_delta: 21,
    },
  ]);
});

test('top-10 migration computes grouped rankings once per replay and keeps identical values', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    createSpotifySchema(sqlite);
    sqlite.exec(`INSERT INTO sh_spotify_releases VALUES ('new','2026-01-01'),('old','2025-01-01')`);
    for (let track = 0; track < 30; track += 1) {
      sqlite.prepare('INSERT INTO sh_spotify_tracks VALUES (?,?,?)').run(`t${track}`, track % 2 ? 'old' : 'new', 'song');
      sqlite.prepare('INSERT INTO sh_spotify_track_targets VALUES (?,?)').run(`t${track}`, `a${track % 2}`);
      for (let day = 1; day <= 28; day += 1) {
        sqlite.prepare('INSERT INTO sh_spotify_playcount_daily VALUES (?,?,?,?,?,0)')
          .run(`2026-09-${String(day).padStart(2, '0')}`, `t${track}`, 1000 + day * track,
            day % 5 ? track : null, day);
      }
    }
    sqlite.exec(migration);
    sqlite.exec(top10Migration.replaceAll('AS MATERIALIZED (', 'AS ('));
    const expected = rows(sqlite);
    sqlite.exec(top10Migration);
    assert.deepEqual(rows(sqlite), expected);
    sqlite.exec(top10Migration);
    assert.deepEqual(rows(sqlite), expected);
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${top10Migration}`).all().map(row => row.detail);
    assert.ok(plan.includes('MATERIALIZE top10_all'));
    assert.ok(plan.includes('MATERIALIZE top10_year'));
  } finally { sqlite.close(); }
});
