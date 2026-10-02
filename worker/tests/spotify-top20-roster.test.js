import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SPOTIFY_ALWAYS_COLLECT_ARTISTS,
  SPOTIFY_CURRENT_TOP20_ARTISTS,
  SPOTIFY_TARGET_ARTISTS,
  SPOTIFY_TOP20_RANKING_DATE,
} from '../src/spotify-playcount-common.js';

test('current comparable female-idol Spotify roster contains exactly ranks 1-20', () => {
  assert.equal(SPOTIFY_TOP20_RANKING_DATE, '2026-09-23');
  assert.equal(SPOTIFY_CURRENT_TOP20_ARTISTS.length, 20);
  assert.deepEqual(SPOTIFY_CURRENT_TOP20_ARTISTS.map(({ rank }) => rank),
    Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(new Set(SPOTIFY_CURRENT_TOP20_ARTISTS.map(({ artist_key }) => artist_key)).size, 20);
  assert.equal(new Set(SPOTIFY_CURRENT_TOP20_ARTISTS.map(({ spotify_artist_id }) => spotify_artist_id)).size, 20);
});

test('initial Top 20 includes all three Sakamichi groups at the agreed filtered ranks', () => {
  const byKey = new Map(SPOTIFY_CURRENT_TOP20_ARTISTS.map((artist) => [artist.artist_key, artist]));
  assert.equal(byKey.get('nogizaka46')?.rank, 5);
  assert.equal(byKey.get('sakurazaka46')?.rank, 16);
  assert.equal(byKey.get('hinatazaka46')?.rank, 18);
});

test('historical explicit additions remain defined but are not collection targets', () => {
  assert.deepEqual(SPOTIFY_ALWAYS_COLLECT_ARTISTS.map(({ artist_key }) => artist_key), [
    'shiritsu-ebisu-chugaku',
    'nearly-equal-joy',
  ]);
  assert.deepEqual(SPOTIFY_TARGET_ARTISTS.map(({ artist_key }) => artist_key), [
    'nogizaka46',
    'sakurazaka46',
    'hinatazaka46',
  ]);
});

test('collection roster is strictly the three Sakamichi groups', () => {
  const schedule = readFileSync(new URL('../src/spotify-playcount-schedule.js', import.meta.url), 'utf8');
  assert.match(schedule, /SPOTIFY_TARGET_ARTISTS/);
  assert.match(schedule, /return SPOTIFY_TARGET_ARTISTS\.map/);
  assert.match(schedule, /t\.artist_key IN \(\$\{placeholders\}\)/);
  assert.match(schedule, /INSERT INTO sh_spotify_top20_history/);
  assert.doesNotMatch(schedule, /SPOTIFY_ALWAYS_COLLECT_ARTISTS/);
  assert.doesNotMatch(schedule, /EXISTS \(\s*SELECT 1 FROM sh_spotify_top20_history h WHERE h\.artist_key=a\.artist_key/);
  assert.doesNotMatch(schedule, /DELETE FROM sh_spotify_artists/);
});

test('completed current day is reopened only when a Sakamichi target is missing', () => {
  const schedule = readFileSync(new URL('../src/spotify-playcount-schedule.js', import.meta.url), 'utf8');
  assert.match(schedule, /missingTargetArtists/);
  assert.match(schedule, /FROM sh_spotify_artist_daily/);
  assert.match(schedule, /recovery: 'target-backfill'/);
  assert.match(schedule, /forceRefresh: true/);
  assert.match(schedule, /Boolean\(selection\.forceRefresh\)/);
});

test('migration seeds the additive roster and Top 20 history', () => {
  const migration = readFileSync(new URL('../../database/other-migrations/043_spotify_ever_top20_roster.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_spotify_top20_history/);
  assert.match(migration, /'2026-09-23', 'equal-love', 1/);
  assert.match(migration, /'2026-09-23', 'sweet-steady', 20/);
  assert.doesNotMatch(migration, /DELETE FROM sh_spotify_artists/);
});
