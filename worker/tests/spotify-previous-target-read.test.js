import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { spotifyPreviousTargetPlaycountsStatement } from '../src/spotify-playcount-consumer.js';

const migration = readFileSync(
  new URL('../../database/other-migrations/042_spotify_track_identity.sql', import.meta.url),
  'utf8',
);

test('targeted previous-day read is equivalent to the legacy canonical view without a historical scan', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA automatic_index=OFF;
      CREATE TABLE sh_spotify_playcount_daily (
        snapshot_date TEXT NOT NULL, track_id TEXT NOT NULL, playcount INTEGER NOT NULL,
        PRIMARY KEY(snapshot_date,track_id)
      );
      CREATE TABLE sh_spotify_track_targets (
        track_id TEXT NOT NULL, artist_key TEXT NOT NULL,
        PRIMARY KEY(track_id,artist_key)
      );
      CREATE INDEX idx_targets_artist_key ON sh_spotify_track_targets(artist_key,track_id);
    `);
    db.exec(migration);
    db.exec(`
      INSERT INTO sh_spotify_track_aliases
        (source_track_id,song_key,canonical_track_id,first_seen_at,last_seen_at)
      VALUES
        ('source-a','song-a','canonical-a',1,1),
        ('source-b','song-a','canonical-a',1,1),
        ('canonical-a','song-a','canonical-a',1,1),
        ('remapped','song-c','elsewhere',1,1),
        ('source-c','song-d','canonical-no-self',1,1);
      INSERT INTO sh_spotify_track_targets VALUES
        ('canonical-a','sakurazaka46'),
        ('canonical-a','nogizaka46'),
        ('plain','hinatazaka46'),
        ('elsewhere','nogizaka46'),
        ('not-observed','sakurazaka46'),
        ('remapped','sakurazaka46'),
        ('canonical-no-self','sakurazaka46'),
        ('unrelated','another-artist');
      INSERT INTO sh_spotify_playcount_daily VALUES
        ('2026-10-13','source-a',100),
        ('2026-10-13','source-b',130),
        ('2026-10-13','canonical-a',120),
        ('2026-10-13','plain',50),
        ('2026-10-13','remapped',900),
        ('2026-10-13','unrelated',300),
        ('2026-10-13','canonical-no-self',70),
        ('2026-10-13','source-c',80),
        ('2026-10-12','canonical-a',1000),
        ('2026-10-14','plain',999);
    `);
    db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000)
      INSERT INTO sh_spotify_playcount_daily SELECT '2026-10-13','unrelated-'||x,x FROM n;`);
    const keys = ['sakurazaka46', 'nogizaka46', 'hinatazaka46'];
    const previousDate = '2026-10-13';
    const old = db.prepare(`SELECT DISTINCT daily.track_id,daily.playcount
      FROM sh_spotify_playcount_daily_canonical daily
      JOIN sh_spotify_track_targets target ON target.track_id=daily.track_id
      WHERE daily.snapshot_date=?
        AND target.artist_key IN (?,?,?)
      ORDER BY daily.track_id`).all(previousDate, ...keys).map(row => ({ ...row }));
    let sql;
    const stmt = spotifyPreviousTargetPlaycountsStatement({
      prepare(query) {
        sql = query;
        // Model the Cloudflare D1 bind(...).all() interface using SQLite.
        return { bind(...args) { return { all() { return db.prepare(query).all(...args); } }; } };
      },
    }, previousDate, keys);
    const current = stmt.all().map(row => ({ ...row }));
    assert.deepEqual(current, old);
    assert.deepEqual(current, [
      { track_id: 'canonical-a', playcount: 130 },
      { track_id: 'canonical-no-self', playcount: 80 },
      { track_id: 'elsewhere', playcount: 900 },
      { track_id: 'plain', playcount: 50 },
    ]);

    const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql)
      .all(...keys, previousDate).map(row => row.detail).join('\n');
    assert.match(plan, /SEARCH daily USING .*\(snapshot_date=\? AND track_id=\?\)/);
    assert.match(plan, /SEARCH alias USING .*\(canonical_track_id=\?\)/);
    assert.doesNotMatch(plan, /SCAN daily|SCAN alias|MATERIALIZE sh_spotify_playcount_daily_canonical/);
  } finally {
    db.close();
  }
});

test('empty target scope cannot trigger an unbounded historical read', () => {
  assert.throws(
    () => spotifyPreviousTargetPlaycountsStatement({ prepare() { throw new Error('unexpected SQL'); } }, '2026-10-13', []),
    /target keys are required/,
  );
});
