import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  runSpotifyDeltaHistoryRepair,
  spotifyDeltaHistoryRepairDates,
} from '../scripts/repair-spotify-delta-history-actions.mjs';

function createD1(database) {
  const statement = (sql, bindings = []) => ({
    bind(...values) { return statement(sql, values); },
    all() { return { results: database.prepare(sql).all(...bindings).map((row) => ({ ...row })) }; },
    first() {
      const row = database.prepare(sql).get(...bindings);
      return row ? { ...row } : null;
    },
    run() {
      const result = database.prepare(sql).run(...bindings);
      return { meta: { changes: Number(result.changes || 0) } };
    },
  });
  const adapter = {
    scriptCalls: 0,
    batchCalls: 0,
    prepare(sql) { return statement(sql); },
    async script(statements) {
      adapter.scriptCalls += 1;
      database.exec('BEGIN');
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        database.exec('COMMIT');
        return results.at(-1);
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    async batch(statements) {
      adapter.batchCalls += 1;
      const results = [];
      for (const item of statements) results.push(await item.run());
      return results;
    },
  };
  return adapter;
}

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sh_spotify_playcount_daily (
      snapshot_date TEXT NOT NULL,
      track_id INTEGER NOT NULL,
      playcount INTEGER NOT NULL,
      delta INTEGER,
      collected_at INTEGER NOT NULL,
      is_carried_forward INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(snapshot_date,track_id)
    );
    CREATE TABLE sh_spotify_track_targets (
      track_id INTEGER NOT NULL,
      artist_key TEXT NOT NULL,
      PRIMARY KEY(track_id,artist_key)
    );
    CREATE TABLE sh_spotify_tracks (
      track_id INTEGER PRIMARY KEY,
      album_id TEXT NOT NULL
    );
    CREATE TABLE sh_spotify_releases (
      album_id TEXT PRIMARY KEY,
      release_date TEXT NOT NULL
    );
    CREATE TABLE sh_spotify_track_aliases (
      source_track_id INTEGER PRIMARY KEY,
      canonical_track_id INTEGER NOT NULL
    );
    CREATE TABLE sh_spotify_artist_daily (
      snapshot_date TEXT NOT NULL,
      artist_key TEXT NOT NULL,
      total_delta INTEGER,
      track_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      top10_delta INTEGER,
      top10_year_delta INTEGER,
      PRIMARY KEY(snapshot_date,artist_key)
    );
  `);

  const tracks = [861, 862, 863, 864, 865];
  for (const trackId of tracks) {
    sqlite.prepare('INSERT INTO sh_spotify_tracks(track_id,album_id) VALUES (?,?)').run(trackId, `album-${trackId}`);
    sqlite.prepare('INSERT INTO sh_spotify_releases(album_id,release_date) VALUES (?,?)').run(`album-${trackId}`, '2025-01-01');
    sqlite.prepare('INSERT INTO sh_spotify_track_targets(track_id,artist_key) VALUES (?,?)').run(trackId, 'nogizaka46');
    const days = [
      ['2026-10-22', 2_172_626, 0, 0],
      ['2026-10-23', 2_172_726, 100, 0],
      ['2026-10-24', 0, -2_172_726, 0],
      ['2026-10-25', 2_369_690, 2_369_690, 0],
      ['2026-10-26', 2_406_164, 36_474, 0],
    ];
    for (const [date, playcount, delta, carried] of days) {
      sqlite.prepare(`INSERT INTO sh_spotify_playcount_daily
        (snapshot_date,track_id,playcount,delta,collected_at,is_carried_forward)
        VALUES (?,?,?,?,?,?)`)
        .run(date, trackId, playcount, delta, 1_800_000_000_000, carried);
    }
  }

  const summaries = [
    ['2026-10-22', 0],
    ['2026-10-23', 500],
    ['2026-10-24', -10_863_630],
    ['2026-10-25', 11_848_450],
    ['2026-10-26', 182_370],
  ];
  for (const [date, total] of summaries) {
    sqlite.prepare(`INSERT INTO sh_spotify_artist_daily
      (snapshot_date,artist_key,total_delta,track_count,updated_at,top10_delta,top10_year_delta)
      VALUES (?,?,?,?,?,?,?)`)
      .run(date, 'nogizaka46', total, 5, 1_800_000_000_000, total, null);
  }
  return { sqlite, db: createD1(sqlite) };
}

test('historical Spotify zero-count regression and rebound are repaired without retaining lifetime-count spikes', async () => {
  const { sqlite, db } = fixture();
  try {
    const report = await runSpotifyDeltaHistoryRepair({
      db,
      today: '2026-10-26',
      now: 1_800_000_000_100,
      logger: () => {},
    });

    assert.equal(report.status, 'repaired');
    assert.equal(report.write_mode, 'script');
    assert.equal(report.changed_rows, null);
    assert.equal(db.scriptCalls, 4);
    assert.equal(db.batchCalls, 0);
    assert.ok(report.repairs.every((row) => row.write_mode === 'script' && row.write_statements === 3));
    assert.deepEqual(report.outliers_before.map((row) => row.snapshot_date), ['2026-10-24', '2026-10-25']);
    assert.deepEqual(report.outliers_after, []);
    assert.deepEqual(report.repair_dates, ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);

    const zeroDay = { ...sqlite.prepare(`SELECT playcount,delta,is_carried_forward
      FROM sh_spotify_playcount_daily WHERE snapshot_date=? AND track_id=?`).get('2026-10-24', 861) };
    assert.deepEqual(zeroDay, { playcount: 2_172_726, delta: 0, is_carried_forward: 1 });

    const reboundDay = { ...sqlite.prepare(`SELECT playcount,delta,is_carried_forward
      FROM sh_spotify_playcount_daily WHERE snapshot_date=? AND track_id=?`).get('2026-10-25', 861) };
    assert.deepEqual(reboundDay, { playcount: 2_369_690, delta: 196_964, is_carried_forward: 0 });

    const nextDay = { ...sqlite.prepare(`SELECT playcount,delta,is_carried_forward
      FROM sh_spotify_playcount_daily WHERE snapshot_date=? AND track_id=?`).get('2026-10-26', 861) };
    assert.deepEqual(nextDay, { playcount: 2_406_164, delta: 36_474, is_carried_forward: 0 });

    const summary = sqlite.prepare(`SELECT snapshot_date,total_delta FROM sh_spotify_artist_daily
      WHERE artist_key='nogizaka46' AND snapshot_date BETWEEN ? AND ? ORDER BY snapshot_date`)
      .all('2026-10-23', '2026-10-26')
      .map((row) => ({ ...row }));
    assert.deepEqual(summary, [
      { snapshot_date: '2026-10-23', total_delta: 500 },
      { snapshot_date: '2026-10-24', total_delta: 0 },
      { snapshot_date: '2026-10-25', total_delta: 984_820 },
      { snapshot_date: '2026-10-26', total_delta: 182_370 },
    ]);
  } finally {
    sqlite.close();
  }
});

test('Spotify historical repair only revisits adjacent dates around detected outliers', () => {
  assert.deepEqual(
    spotifyDeltaHistoryRepairDates(
      ['2026-10-24', '2026-10-25', '2026-10-25', '2026-09-28'],
      '2026-09-28',
      '2026-10-26',
    ),
    ['2026-09-28', '2026-09-29', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'],
  );
});
