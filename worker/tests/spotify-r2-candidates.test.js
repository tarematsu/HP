import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  cleanupSpotifyR2RunCandidates,
  loadSpotifyR2RunCandidates,
  saveSpotifyR2AlbumCandidates,
  spotifyR2CandidatesEnabled,
  spotifyR2CandidateRunPrefix,
} from '../src/spotify-r2-candidates.js';
import { spotifyDailyFinalizeR2Statement, spotifyDailyFinalizeStatement } from '../src/spotify-playcount-daily-write.js';

function fakeR2() {
  const objects = new Map();
  const writes = [];
  const bucket = {
    objects, writes,
    async put(key, body) { objects.set(key, String(body)); writes.push(key); },
    async get(key) { return objects.has(key) ? { async json() { return JSON.parse(objects.get(key)); } } : null; },
    async list({ prefix, cursor } = {}) {
      const keys = [...objects.keys()].filter(key => key.startsWith(prefix || '')).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + 2);
      return {
        objects: slice.map(key => ({ key })), truncated: start + 2 < keys.length,
        cursor: String(start + 2),
      };
    },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
  };
  return bucket;
}

function observation(albumId, runToken = 'run:1') {
  return { snapshot_date: '2026-10-14', album_id: albumId, run_token: runToken };
}

test('Spotify R2 mode requires opt-in and isolates attempts by day and run token', () => {
  assert.equal(spotifyR2CandidatesEnabled({}), false);
  assert.equal(spotifyR2CandidatesEnabled({ SPOTIFY_R2_CANDIDATES_ENABLED: true }), true);
  assert.equal(spotifyR2CandidateRunPrefix(observation('a')), 'spotify-playcount-candidates/v1/2026-10-14/run%3A1/');
  assert.notEqual(spotifyR2CandidateRunPrefix(observation('a', 'run:2')),
    spotifyR2CandidateRunPrefix(observation('a')));
});

test('immutable album receipts preserve highest playcount across out-of-order retries and duplicate albums', async () => {
  const bucket = fakeR2();
  const env = { PAGES_RESPONSE_R2: bucket };
  const albumA = observation('A');
  const albumB = observation('B');
  await saveSpotifyR2AlbumCandidates(env, albumA, [
    { track_id: 'x', playcount: 100 }, { track_id: 'y', playcount: 200 },
  ], 1000);
  await saveSpotifyR2AlbumCandidates(env, albumA, [
    { track_id: 'x', playcount: 102 }, { track_id: 'y', playcount: 200 },
  ], 2000);
  await saveSpotifyR2AlbumCandidates(env, albumA, [
    { track_id: 'x', playcount: 101 }, { track_id: 'y', playcount: 200 },
  ], 3000);
  await saveSpotifyR2AlbumCandidates(env, albumB, [
    { track_id: 'x', playcount: 101 }, { track_id: 'z', playcount: 50 },
  ], 2500);
  assert.equal(bucket.writes.length, 4);
  assert.equal(new Set(bucket.writes).size, 4, 'overlapping messages must never overwrite R2 objects');
  // A failed album is deliberately excluded even if an immutable upload exists.
  await saveSpotifyR2AlbumCandidates(env, observation('failed'), [
    { track_id: 'w', playcount: 99 },
  ], 4000);
  const accepted = [{ album_id: 'A', track_count: 2 }, { album_id: 'B', track_count: 2 }];
  assert.deepEqual(await loadSpotifyR2RunCandidates(env, albumA, accepted), [
    { track_id: 'x', playcount: 102, collected_at: 2000, album_id: 'A' },
    { track_id: 'y', playcount: 200, collected_at: 3000, album_id: 'A' },
    { track_id: 'z', playcount: 50, collected_at: 2500, album_id: 'B' },
  ]);
  assert.equal(await cleanupSpotifyR2RunCandidates(env, albumA), 5);
  assert.equal(bucket.objects.size, 0);
});

test('candidate finalization fails closed if any completed album receipt is missing or malformed', async () => {
  const bucket = fakeR2();
  const env = { PAGES_RESPONSE_R2: bucket };
  const message = observation('A');
  await saveSpotifyR2AlbumCandidates(env, message, [{ track_id: 'x', playcount: 10 }], 1000);
  await assert.rejects(loadSpotifyR2RunCandidates(env, message, [
    { album_id: 'A', track_count: 1 }, { album_id: 'B', track_count: 1 },
  ]), /album missing/);
  await assert.rejects(loadSpotifyR2RunCandidates(env, message, [
    { album_id: 'A', track_count: 2 },
  ]), /count mismatch/, 'a partly published album cannot count as complete');
  const key = bucket.writes[0];
  const raw = JSON.parse(bucket.objects.get(key));
  raw.run_token = 'wrong-run';
  bucket.objects.set(key, JSON.stringify(raw));
  await assert.rejects(loadSpotifyR2RunCandidates(env, message, [
    { album_id: 'A', track_count: 1 },
  ]), /invalid/);
});

test('direct R2 candidate SQLite finalization matches the original daily candidate table results', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`
      CREATE TABLE sh_spotify_playcount_daily(
        snapshot_date TEXT,track_id TEXT,playcount INTEGER,delta INTEGER,
        collected_at INTEGER,is_carried_forward INTEGER,
        PRIMARY KEY(snapshot_date,track_id));
      CREATE TABLE sh_spotify_playcount_candidates(
        snapshot_date TEXT,run_token TEXT,track_id TEXT,album_id TEXT,playcount INTEGER,collected_at INTEGER,
        PRIMARY KEY(snapshot_date,track_id));
      CREATE TABLE sh_spotify_releases(album_id TEXT PRIMARY KEY,release_date TEXT NOT NULL);
      INSERT INTO sh_spotify_releases VALUES
        ('old-release','2025-01-01'),('new-release','2026-10-01');
      CREATE TABLE sh_spotify_track_aliases (
        source_track_id TEXT PRIMARY KEY,song_key TEXT,canonical_track_id TEXT,last_seen_at INTEGER,created_at INTEGER);
      CREATE INDEX idx_sh_spotify_track_aliases_canonical ON sh_spotify_track_aliases(canonical_track_id,source_track_id);
      INSERT INTO sh_spotify_playcount_daily VALUES
        ('2026-10-13','a',100,NULL,1,0),('2026-10-13','b',200,NULL,1,0),
        ('2026-10-13','new-release-track',100,NULL,1,0),('2026-10-13','zeroed',200,NULL,1,0);
      INSERT INTO sh_spotify_playcount_candidates VALUES
        ('2026-10-14','run:1','a','old-release',103,9),
        ('2026-10-14','run:1','b','old-release',198,9),
        ('2026-10-14','run:1','new','old-release',7,9),
        ('2026-10-14','run:1','new-release-track','new-release',40,9),
        ('2026-10-14','run:1','zeroed','old-release',0,9);
    `);
    const db = { prepare(sql) {
      return { bind(...values) { return { run() { return sqlite.prepare(sql).run(...values); } }; } };
    } };
    const message = observation('A');
    const rows = [
      { track_id:'a',playcount:103,collected_at:9,album_id:'old-release' },
      { track_id:'b',playcount:198,collected_at:9,album_id:'old-release' },
      { track_id:'new',playcount:7,collected_at:9,album_id:'old-release' },
      { track_id:'new-release-track',playcount:40,collected_at:9,album_id:'new-release' },
      { track_id:'zeroed',playcount:0,collected_at:9,album_id:'old-release' },
    ];
    spotifyDailyFinalizeStatement(db,message,'2026-10-13').run();
    const snapshot = () => sqlite.prepare(`SELECT track_id,playcount,delta,collected_at,is_carried_forward
      FROM sh_spotify_playcount_daily WHERE snapshot_date='2026-10-14' ORDER BY track_id`).all()
      .map(row => ({ ...row }));
    const legacy = snapshot();
    sqlite.exec("DELETE FROM sh_spotify_playcount_daily WHERE snapshot_date='2026-10-14'");
    spotifyDailyFinalizeR2Statement(db,message,'2026-10-13',rows).run();
    assert.deepEqual(snapshot(),legacy);
    assert.deepEqual(snapshot(), [
      { track_id:'a',playcount:103,delta:3,collected_at:9,is_carried_forward:0 },
      { track_id:'b',playcount:198,delta:-2,collected_at:9,is_carried_forward:0 },
      { track_id:'new',playcount:7,delta:null,collected_at:9,is_carried_forward:0 },
      { track_id:'new-release-track',playcount:40,delta:40,collected_at:9,is_carried_forward:0 },
      { track_id:'zeroed',playcount:200,delta:0,collected_at:9,is_carried_forward:1 },
    ]);
    assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM sh_spotify_playcount_candidates`).get().n,5,
      'R2 finalization does not need to insert candidate rows into D1');
  } finally { sqlite.close(); }
});
