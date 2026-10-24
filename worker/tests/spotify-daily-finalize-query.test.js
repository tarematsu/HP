import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { spotifyDailyFinalizeStatement } from '../src/spotify-playcount-daily-write.js';

test('daily finalization seeks aliases and applies narrow Spotify regression rules', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA automatic_index=OFF;
      CREATE TABLE sh_spotify_playcount_daily (
        snapshot_date TEXT,track_id TEXT,playcount INTEGER,delta INTEGER,
        collected_at INTEGER,is_carried_forward INTEGER,
        PRIMARY KEY(snapshot_date,track_id)
      );
      CREATE TABLE sh_spotify_playcount_candidates (
        snapshot_date TEXT,run_token TEXT,track_id TEXT,album_id TEXT,
        playcount INTEGER,collected_at INTEGER,
        PRIMARY KEY(snapshot_date,track_id)
      );
      CREATE TABLE sh_spotify_releases (
        album_id TEXT PRIMARY KEY,release_date TEXT NOT NULL
      );`);
    db.exec(readFileSync(new URL('../../database/other-migrations/042_spotify_track_identity.sql', import.meta.url), 'utf8'));
    db.exec(`
      INSERT INTO sh_spotify_releases VALUES
        ('old-release','2025-05-01'),('new-release','2026-09-15');
      INSERT INTO sh_spotify_track_aliases VALUES
        ('a','song','canonical',1,1),('b','song','canonical',1,1),
        ('canonical','song','canonical',1,1),('remapped','other','elsewhere',1,1);
      INSERT INTO sh_spotify_playcount_daily VALUES
        ('2026-09-29','a',100,NULL,1,0),('2026-09-29','b',120,NULL,1,0),
        ('2026-09-29','canonical',110,NULL,1,0),('2026-09-29','plain',50,NULL,1,0),
        ('2026-09-29','remapped',900,NULL,1,0),('2026-09-29','new-release-track',100,NULL,1,0),
        ('2026-09-29','zeroed',1234567,NULL,1,0),('2026-09-29','old-adjusted',200,NULL,1,0),
        ('2026-09-28','plain',999,NULL,1,0),
        ('2026-09-30','canonical',1,NULL,1,1);
      INSERT INTO sh_spotify_playcount_candidates VALUES
        ('2026-09-30','run','canonical','old-release',130,20),
        ('2026-09-30','run','plain','old-release',45,20),
        ('2026-09-30','run','new','old-release',10,20),
        ('2026-09-30','run','elsewhere','old-release',950,20),
        ('2026-09-30','run','remapped','old-release',1000,20),
        ('2026-09-30','run','new-release-track','new-release',40,20),
        ('2026-09-30','run','zeroed','old-release',0,20),
        ('2026-09-30','run','old-adjusted','old-release',198,20),
        ('2026-09-30','old-run','ignored','old-release',100,20),
        ('2026-09-28','run','other-date','old-release',100,20);
    `);
    let sql, parameters;
    spotifyDailyFinalizeStatement({ prepare(value) {
      sql = value;
      return { bind(...args) { parameters = args; return this; } };
    } }, { snapshot_date: '2026-09-30', run_token: 'run' }, '2026-09-29');
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters).map((r) => r.detail).join('\n');
    assert.match(plan, /SEARCH p USING INDEX .*\(snapshot_date=\? AND track_id=\?\)/);
    assert.match(plan, /SEARCH a USING COVERING INDEX idx_sh_spotify_track_aliases_canonical/);
    assert.doesNotMatch(plan, /SCAN (?:p|a|daily|alias)\b/);
    db.prepare(sql).run(...parameters);
    const actual = db.prepare(`SELECT track_id,playcount,delta,is_carried_forward
      FROM sh_spotify_playcount_daily WHERE snapshot_date='2026-09-30' ORDER BY track_id`).all()
      .map((row) => ({ ...row }));
    assert.deepEqual(actual, [
      { track_id: 'canonical', playcount: 130, delta: 10, is_carried_forward: 0 },
      { track_id: 'elsewhere', playcount: 950, delta: 50, is_carried_forward: 0 },
      { track_id: 'new', playcount: 10, delta: null, is_carried_forward: 0 },
      { track_id: 'new-release-track', playcount: 40, delta: 40, is_carried_forward: 0 },
      { track_id: 'old-adjusted', playcount: 198, delta: -2, is_carried_forward: 0 },
      { track_id: 'plain', playcount: 45, delta: -5, is_carried_forward: 0 },
      { track_id: 'remapped', playcount: 1000, delta: null, is_carried_forward: 0 },
      { track_id: 'zeroed', playcount: 1234567, delta: 0, is_carried_forward: 1 },
    ]);
  } finally { db.close(); }
});
