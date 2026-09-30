import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { spotifyDailyFinalizeStatement } from '../src/spotify-playcount-daily-write.js';

test('daily finalization seeks aliases and date/track keys and preserves canonical deltas', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA automatic_index=OFF;
      CREATE TABLE sh_spotify_playcount_daily (
        snapshot_date TEXT,track_id TEXT,playcount INTEGER,delta INTEGER,
        collected_at INTEGER,is_carried_forward INTEGER,
        PRIMARY KEY(snapshot_date,track_id)
      );
      CREATE TABLE sh_spotify_playcount_candidates (
        snapshot_date TEXT,run_token TEXT,track_id TEXT,playcount INTEGER,collected_at INTEGER,
        PRIMARY KEY(snapshot_date,track_id)
      );`);
    db.exec(readFileSync(new URL('../../database/other-migrations/042_spotify_track_identity.sql', import.meta.url), 'utf8'));
    db.exec(`
      INSERT INTO sh_spotify_track_aliases VALUES
        ('a','song','canonical',1,1),('b','song','canonical',1,1),
        ('canonical','song','canonical',1,1),('remapped','other','elsewhere',1,1);
      INSERT INTO sh_spotify_playcount_daily VALUES
        ('2026-09-29','a',100,NULL,1,0),('2026-09-29','b',120,NULL,1,0),
        ('2026-09-29','canonical',110,NULL,1,0),('2026-09-29','plain',50,NULL,1,0),
        ('2026-09-29','remapped',900,NULL,1,0),
        ('2026-09-28','plain',999,NULL,1,0),
        ('2026-09-30','canonical',1,NULL,1,1);
      INSERT INTO sh_spotify_playcount_candidates VALUES
        ('2026-09-30','run','canonical',130,20),('2026-09-30','run','plain',45,20),
        ('2026-09-30','run','new',10,20),('2026-09-30','run','elsewhere',950,20),
        ('2026-09-30','run','remapped',1000,20),
        ('2026-09-30','old-run','ignored',100,20),('2026-09-28','run','other-date',100,20);
    `);
    const expected = db.prepare(`SELECT c.track_id,c.playcount-p.playcount AS delta
      FROM sh_spotify_playcount_candidates c
      LEFT JOIN sh_spotify_playcount_daily_canonical p
        ON p.snapshot_date='2026-09-29' AND p.track_id=c.track_id
      WHERE c.snapshot_date='2026-09-30' AND c.run_token='run'
      ORDER BY c.track_id`).all().map((row) => ({ ...row }));
    let sql, parameters;
    spotifyDailyFinalizeStatement({ prepare(value) {
      sql = value;
      return { bind(...args) { parameters = args; return this; } };
    } }, { snapshot_date: '2026-09-30', run_token: 'run' }, '2026-09-29');
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters).map((r) => r.detail).join('\n');
    assert.match(plan, /SEARCH p USING INDEX .*\(snapshot_date=\? AND track_id=\?\)/);
    assert.match(plan, /SEARCH a USING COVERING INDEX idx_sh_spotify_track_aliases_canonical/);
    assert.doesNotMatch(plan, /SCAN (?:p|a|daily|alias)\b|MATERIALIZE/);
    db.prepare(sql).run(...parameters);
    const actual = db.prepare("SELECT track_id,delta FROM sh_spotify_playcount_daily WHERE snapshot_date='2026-09-30' ORDER BY track_id").all().map((row) => ({ ...row }));
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual, [
      { track_id: 'canonical', delta: 10 }, { track_id: 'elsewhere', delta: 50 },
      { track_id: 'new', delta: null }, { track_id: 'plain', delta: -5 },
      { track_id: 'remapped', delta: null },
    ]);
    assert.equal(db.prepare("SELECT is_carried_forward FROM sh_spotify_playcount_daily WHERE snapshot_date='2026-09-30' AND track_id='canonical'").get().is_carried_forward, 0);
  } finally { db.close(); }
});
