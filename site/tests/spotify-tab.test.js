import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  onRequestGet,
  spotifyArtist,
  spotifyPayload,
  spotifyPlaycountSql,
} from '../functions/api/spotify-playcounts.js';

function mockDb(rows, expectedArtist = 'sakurazaka46') {
  return {
    prepare(sql) {
      assert.equal(sql, spotifyPlaycountSql());
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async all() {
          assert.deepEqual(this.args, [expectedArtist, expectedArtist]);
          return { results: rows };
        },
      };
    },
  };
}

test('Spotify API defaults to Sakurazaka and supports all three groups', () => {
  assert.deepEqual(spotifyArtist(), { key: 'sakurazaka46', name: '櫻坂46' });
  assert.deepEqual(spotifyArtist('nogizaka46'), { key: 'nogizaka46', name: '乃木坂46' });
  assert.deepEqual(spotifyArtist('hinatazaka46'), { key: 'hinatazaka46', name: '日向坂46' });
  assert.equal(spotifyArtist('unknown'), null);
});

test('Spotify payload exposes cumulative counts, daily deltas, and carry-forward state', () => {
  const payload = spotifyPayload(spotifyArtist(), [
    {
      snapshot_date: '2026-09-27',
      track_id: 'track-a',
      name: 'Song A',
      playcount: 1234567,
      delta: 12345,
      collected_at: 1_800_000_000_000,
      is_carried_forward: 0,
    },
    {
      snapshot_date: '2026-09-27',
      track_id: 'track-b',
      name: 'Song B',
      playcount: 765432,
      delta: 4321,
      collected_at: 1_800_000_000_000,
      is_carried_forward: 0,
    },
  ]);
  assert.equal(payload.snapshot_date, '2026-09-27');
  assert.equal(payload.track_count, 2);
  assert.equal(payload.total_delta, 16666);
  assert.equal(payload.carried_forward, false);
  assert.deepEqual(payload.tracks.map(({ rank, track_id }) => [rank, track_id]), [[1, 'track-a'], [2, 'track-b']]);

  const carried = spotifyPayload(spotifyArtist(), [{
    snapshot_date: '2026-09-28',
    track_id: 'track-a',
    name: 'Song A',
    playcount: 1234567,
    delta: null,
    collected_at: 1_800_086_400_000,
    is_carried_forward: 1,
  }]);
  assert.equal(carried.carried_forward, true);
  assert.equal(carried.total_delta, null);
});

test('Spotify API reads only the selected artist from OTHER_DB', async () => {
  const rows = [{
    snapshot_date: '2026-09-27',
    track_id: 'track-a',
    name: 'Song A',
    playcount: 100,
    delta: 5,
    collected_at: 1_800_000_000_000,
    is_carried_forward: 0,
  }];
  const response = await onRequestGet({
    request: new Request('https://skrzk.test/api/spotify-playcounts?artist=sakurazaka46'),
    env: { OTHER_DB: mockDb(rows) },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.artist.key, 'sakurazaka46');
  assert.equal(payload.tracks[0].playcount, 100);
});

test('Spotify API rejects unknown artists and missing D1 binding', async () => {
  const unknown = await onRequestGet({
    request: new Request('https://skrzk.test/api/spotify-playcounts?artist=unknown'),
    env: { OTHER_DB: mockDb([]) },
  });
  assert.equal(unknown.status, 400);

  const missing = await onRequestGet({
    request: new Request('https://skrzk.test/api/spotify-playcounts'),
    env: {},
  });
  assert.equal(missing.status, 503);
});

test('Spotify tab mounts three group switches with Sakurazaka selected by default', () => {
  const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

  assert.match(shell, /data-view = 'spotify'|dataset\.view = 'spotify'/);
  assert.match(shell, /data-spotify-artist="nogizaka46"/);
  assert.match(shell, /data-spotify-artist="sakurazaka46" class="active" aria-pressed="true"/);
  assert.match(shell, /data-spotify-artist="hinatazaka46"/);
  assert.match(runtime, /const DEFAULT_ARTIST = 'sakurazaka46'/);
  assert.match(runtime, /\/api\/spotify-playcounts\?artist=/);
  assert.match(runtime, /if \(value == null \|\| value === ''\) return '-'/);
  assert.match(tabs, /VIEW_MODES[\s\S]*'spotify'/);
  assert.match(tabs, /const spotifyView = document\.getElementById\('spotifyView'\)/);
  assert.match(tabs, /async function showSpotify/);
  assert.match(tabs, /import\('\/spotify\.js\?v=20260927\.2'\)/);
  assert.match(tabs, /else if \(mode === 'spotify'\) void showSpotify/);
  assert.match(tabs, /button\.dataset\.view === 'spotify'/);
  assert.match(dashboard, /spotify-shell\.js/);
  assert.match(dashboard, /dashboard-tabs\.js\?v=20260927\.4/);
  assert.doesNotMatch(dashboard, /spotify-tab-router/);
});
