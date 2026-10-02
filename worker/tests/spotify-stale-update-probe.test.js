import assert from 'node:assert/strict';
import test from 'node:test';
import { probeStaleSpotifyUpdate } from '../src/spotify-stale-update-probe.js';

function probeDb() {
  let writes = 0;
  let reads = 0;
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() {
          reads += 1;
          assert.match(sql, /sh_spotify_collection_runs/);
          assert.equal(args[0], '2026-10-03');
          return { snapshot_date: '2026-10-02', run_token: 'stale-run' };
        },
        async all() {
          reads += 1;
          assert.match(sql, /sh_spotify_playcount_candidates/);
          assert.deepEqual(args.slice(0, 2), ['2026-10-02', 'stale-run']);
          return { results: [
            { track_id: 'track-1', playcount: 100, album_id: 'album-1' },
            { track_id: 'track-2', playcount: 90, album_id: 'album-1' },
          ] };
        },
        async run() { writes += 1; },
      };
    },
  };
  return { db, writes: () => writes, reads: () => reads };
}

function dependencies(playcounts) {
  return {
    fetchAnonymousSession: async () => ({ accessToken: 'test' }),
    fetchAlbumPlaycountPayload: async () => ({ data: { album: {} } }),
    normalizeAlbumTracks: () => Object.entries(playcounts).map(([track_id, playcount]) => ({
      track_id,
      playcount,
    })),
    fetchImpl: async () => { throw new Error('unexpected raw fetch'); },
  };
}

test('unchanged overnight Spotify source uses two reads and zero D1 writes', async () => {
  const { db, writes, reads } = probeDb();
  const result = await probeStaleSpotifyUpdate(
    { OTHER_DB: db },
    Date.parse('2026-10-02T15:10:00Z'),
    dependencies({ 'track-1': 100, 'track-2': 90 }),
  );
  assert.equal(result.stale, true);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'source-unchanged');
  assert.equal(result.checked_tracks, 2);
  assert.equal(reads(), 2);
  assert.equal(writes(), 0);
});

test('overnight probe detects a published playcount change without writing D1', async () => {
  const { db, writes, reads } = probeDb();
  const result = await probeStaleSpotifyUpdate(
    { OTHER_DB: db },
    Date.parse('2026-10-02T15:20:00Z'),
    dependencies({ 'track-1': 101, 'track-2': 90 }),
  );
  assert.equal(result.stale, true);
  assert.equal(result.changed, true);
  assert.equal(result.track_id, 'track-1');
  assert.equal(result.previous_playcount, 100);
  assert.equal(result.current_playcount, 101);
  assert.equal(reads(), 2);
  assert.equal(writes(), 0);
});
