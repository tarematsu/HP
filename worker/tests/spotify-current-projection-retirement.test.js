import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { spotifyDailyFinalizeStatement } from '../src/spotify-playcount-daily-write.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Spotify collection completes from canonical daily values without a current-value D1 rewrite', () => {
  const consumer = source('../src/spotify-playcount-consumer.js');
  const api = source('../src/pages-query-api-spotify-playcounts.js');
  const detail = source('../src/spotify-read-model-detail.js');
  assert.doesNotMatch(consumer, /(?:INSERT INTO|UPDATE|DELETE FROM) sh_spotify_playcount_current/);
  assert.match(consumer, /spotifyDailyFinalizeStatement\(db, message, previousDate\)/);
  assert.match(api, /JOIN sh_spotify_playcount_daily AS d/);
  assert.doesNotMatch(api, /FROM sh_spotify_playcount_current/);
  assert.doesNotMatch(detail, /FROM sh_spotify_playcount_current/);
});

test('canonical daily table retains the current and historical snapshots independently', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`CREATE TABLE sh_spotify_playcount_daily (
      snapshot_date TEXT NOT NULL,track_id TEXT NOT NULL,playcount INTEGER NOT NULL,
      delta INTEGER,collected_at INTEGER,is_carried_forward INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(snapshot_date,track_id));
      CREATE TABLE sh_spotify_playcount_candidates(
        snapshot_date TEXT NOT NULL,run_token TEXT NOT NULL,track_id TEXT NOT NULL,
        album_id TEXT,playcount INTEGER NOT NULL,collected_at INTEGER NOT NULL,
        PRIMARY KEY(snapshot_date,track_id));
      CREATE TABLE sh_spotify_releases(album_id TEXT PRIMARY KEY,release_date TEXT NOT NULL);
      INSERT INTO sh_spotify_releases VALUES ('old-release','2025-01-01');
      CREATE TABLE sh_spotify_track_aliases (
        source_track_id TEXT PRIMARY KEY,song_key TEXT,canonical_track_id TEXT,last_seen_at INTEGER,created_at INTEGER);
      CREATE INDEX idx_sh_spotify_track_aliases_canonical ON sh_spotify_track_aliases(canonical_track_id,source_track_id);
      INSERT INTO sh_spotify_playcount_daily VALUES ('2026-10-12','track-a',1000,NULL,10,0);
      INSERT INTO sh_spotify_playcount_candidates VALUES ('2026-10-13','run-13','track-a','old-release',1030,20);
      `);
    const fake = { prepare(sql) {
      return { bind(...args) {
        return { run: () => sqlite.prepare(sql).run(...args) };
      } };
    } };
    spotifyDailyFinalizeStatement(fake, { snapshot_date: '2026-10-13', run_token: 'run-13' }, '2026-10-12').run();
    const latest = sqlite.prepare(`SELECT snapshot_date,playcount,delta FROM sh_spotify_playcount_daily
      WHERE track_id='track-a' ORDER BY snapshot_date DESC LIMIT 1`).get();
    assert.deepEqual({ ...latest }, { snapshot_date: '2026-10-13', playcount: 1030, delta: 30 });
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sh_spotify_playcount_daily').get().count, 2);
  } finally {
    sqlite.close();
  }
});
