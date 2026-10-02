import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { spotifyAllTracksPayload } from '../public/spotify-all-tracks.js';

const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/spotify-all-tracks.js', import.meta.url), 'utf8');

test('Spotify track list exposes an all-groups filter before the three Sakamichi buttons', () => {
  assert.match(shell, /value: 'all', label: 'すべて'/);
  assert.match(shell, /value: 'sakurazaka46', label: '櫻坂46', active: true/);
  assert.match(shell, /value: 'nogizaka46', label: '乃木坂46'/);
  assert.match(shell, /value: 'hinatazaka46', label: '日向坂46'/);
  assert.match(shell, /installSpotifyAllTracksFilter\(\)/);
  assert.match(runtime, /fetch\('\/api\/spotify-playcounts\?artists=sakamichi'\)/);
  assert.match(runtime, /坂道3グループの再生数一覧/);
});

test('all-groups payload merges the three latest lists, deduplicates canonical tracks, and ranks by delta', () => {
  const model = {
    groups: {
      sakurazaka46: {
        artist: { name: '櫻坂46' },
        snapshot_date: '2026-10-01',
        tracks: [
          { track_id: 1, spotify_track_id: 's1', name: 'S1', playcount: 1000, delta: 30 },
          { track_id: 9, spotify_track_id: 'shared-s', name: 'Shared', playcount: 900, delta: 20 },
        ],
      },
      nogizaka46: {
        artist: { name: '乃木坂46' },
        snapshot_date: '2026-10-02',
        tracks: [
          { track_id: 2, spotify_track_id: 'n1', name: 'N1', playcount: 2000, delta: 50 },
          { track_id: 9, spotify_track_id: 'shared-n', name: 'Shared', playcount: 900, delta: 20 },
        ],
      },
      hinatazaka46: {
        artist: { name: '日向坂46' },
        snapshot_date: '2026-09-30',
        carried_forward: true,
        tracks: [
          { track_id: 3, spotify_track_id: 'h1', name: 'H1', playcount: 3000, delta: 40 },
        ],
      },
    },
  };

  const payload = spotifyAllTracksPayload(model);
  assert.equal(payload.snapshot_date, '2026-10-02');
  assert.deepEqual(payload.carried_forward_artists, ['日向坂46']);
  assert.equal(payload.track_count, 4);
  assert.deepEqual(payload.tracks.map((track) => track.rank), [1, 2, 3, 4]);
  assert.deepEqual(payload.tracks.map((track) => [track.artist_name, track.name, track.delta]), [
    ['乃木坂46', 'N1', 50],
    ['日向坂46', 'H1', 40],
    ['櫻坂46', 'S1', 30],
    ['櫻坂46', 'Shared', 20],
  ]);
});
