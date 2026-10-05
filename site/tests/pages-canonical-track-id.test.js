import { browserSource } from './helpers/dashboard-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { canonicalTrackKey } from '../functions/lib/canonical-track-rows.js';
import { mergeTrackRows } from '../functions/lib/track-history-merge.js';
import { attachCompactTrackLikes } from '../functions/lib/track-likes.js';
import { normalizePlaybackTrack } from '../functions/lib/playback.js';
import { FIRST_WEEK_READ_MODEL_SQL } from '../functions/lib/first-week-comparison.js';

const playedTracks = browserSource('stationhead/played-tracks.js');
const appleMusic = readFileSync(new URL('../public/apple-music.js', import.meta.url), 'utf8');
const amazonMusic = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');
const spotifyApi = readFileSync(new URL('../functions/api/spotify-playcounts.js', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../database/facts-migrations/066_pages_canonical_track_identity.sql', import.meta.url),
  'utf8',
);
const dashboardPublisher = readFileSync(
  new URL('../../worker/src/pages-dashboard-live-publisher.js', import.meta.url),
  'utf8',
);

const date = '2026-09-30';

test('canonical track key always prefers sh_tracks.id over provider aliases', () => {
  assert.equal(canonicalTrackKey({
    track_id: 123,
    isrc: 'JPXXX0000001',
    spotify_id: 'spotify-a',
    stationhead_track_id: 999,
  }), 'track:123');
  assert.equal(canonicalTrackKey({ isrc: 'jp-xxx-0000001' }), 'isrc:JPXXX0000001');
});

test('played-track merge collapses provider variants by sh_tracks.id', () => {
  const rows = mergeTrackRows([
    {
      play_date: date,
      track_id: 42,
      spotify_id: 'spotify-old',
      isrc: 'JPAAA0000001',
      title: 'Song',
      artist: '櫻坂46',
      play_count: 2,
      played_at: 100,
    },
    {
      play_date: date,
      track_id: 42,
      spotify_id: 'spotify-new',
      isrc: 'JPBBB0000002',
      title: 'Song',
      artist: '櫻坂46',
      play_count: 3,
      played_at: 200,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 42);
  assert.equal(rows[0].track_key, 'track:42');
  assert.equal(rows[0].play_count, 5);
});

test('likes attach by sh_tracks.id even when provider ids differ', () => {
  const rows = attachCompactTrackLikes([
    { play_date: date, track_id: 7, spotify_id: 'spotify-a', like_count: 10 },
  ], [
    { play_date: date, track_id: 7, spotify_id: 'spotify-b', like_count: 88, observed_at: 10 },
  ]);
  assert.equal(rows[0].like_count, 88);
});

test('current playback payload exposes sh_tracks.id', () => {
  const row = normalizePlaybackTrack({
    track_id: 91,
    spotify_id: 'spotify-91',
    title: 'Song',
    artist: '櫻坂46',
    duration_ms: 180000,
  }, 0, { currentIndex: 0, progressMs: 5000 });
  assert.equal(row.track_id, 91);
  assert.equal(row.is_current, true);
});

test('Pages song-bearing surfaces keep canonical identity except provider-specific Amazon rank variants', async () => {
  const { trackIdentity }=await import('../public/stationhead/played-tracks.js'); assert.equal(trackIdentity({track_id:42,spotify_id:'provider'}),'track:42'); assert.equal(trackIdentity({spotify_id:'provider'}),'spotify:provider'); assert.match(browserSource('stationhead/normalize.js'),/track_id/);
});

test('MINUTE compatibility views retain canonical track_id for Pages materialization', () => {
  assert.match(migration, /i\.track_id/);
  assert.match(migration, /c\.track_id,c\.queue_track_id/);
  assert.match(migration, /SELECT station_id,track_key,track_id,queue_id/);
  assert.match(migration, /ADD COLUMN track_id INTEGER/);
});
