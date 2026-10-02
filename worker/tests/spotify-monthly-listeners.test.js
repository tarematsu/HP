import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  monthlyListenersFromArtistOverview,
  SPOTIFY_MONTHLY_LISTENER_ARTISTS,
  spotifyArtistOverviewUrl,
} from '../src/spotify-monthly-listeners.js';
import {
  SPOTIFY_MONTHLY_LISTENERS_TYPE,
  spotifyMonthlyListenerRetryDelaySeconds,
} from '../src/spotify-playcount-queue-router.js';

test('monthly listeners are parsed from queryArtistOverview stats', () => {
  assert.equal(monthlyListenersFromArtistOverview({
    data: { artistUnion: { stats: { monthlyListeners: 450738 } } },
  }), 450738);
  assert.equal(monthlyListenersFromArtistOverview({
    data: { artistUnion: { stats: { monthlyListeners: '216390' } } },
  }), 216390);
  assert.equal(monthlyListenersFromArtistOverview({
    data: { artistUnion: { stats: {} } },
  }), null);
});

test('artist overview request uses the verified anonymous Pathfinder operation', () => {
  const url = new URL(spotifyArtistOverviewUrl('0wsE3L0l083t6bxC8jJefC'));
  assert.equal(url.origin + url.pathname, 'https://api-partner.spotify.com/pathfinder/v1/query');
  assert.equal(url.searchParams.get('operationName'), 'queryArtistOverview');
  assert.deepEqual(JSON.parse(url.searchParams.get('variables')), {
    uri: 'spotify:artist:0wsE3L0l083t6bxC8jJefC',
    locale: '',
    preReleaseV2: true,
  });
  assert.equal(
    JSON.parse(url.searchParams.get('extensions')).persistedQuery.sha256Hash,
    '5b9e64f43843fa3a9b6a98543600299b0a2cbbbccfdcdcef2402eb9c1017ca4c',
  );
});

test('monthly listener roster is limited to the Sakamichi groups plus Sakamichi Selection', () => {
  assert.deepEqual(SPOTIFY_MONTHLY_LISTENER_ARTISTS.map(({ artist_key }) => artist_key), [
    'nogizaka46',
    'sakurazaka46',
    'hinatazaka46',
    'sakamichi-selection',
  ]);
  const selection = SPOTIFY_MONTHLY_LISTENER_ARTISTS.at(-1);
  assert.equal(selection.artist_name, '坂道選抜');
  assert.equal(selection.spotify_artist_id, '44VXOtivzQwdqj1Xs80SaX');
});

test('monthly listener retry uses bounded exponential queue delay', () => {
  assert.equal(SPOTIFY_MONTHLY_LISTENERS_TYPE, 'spotify-monthly-listeners');
  assert.equal(spotifyMonthlyListenerRetryDelaySeconds(1), 60);
  assert.equal(spotifyMonthlyListenerRetryDelaySeconds(2), 120);
  assert.equal(spotifyMonthlyListenerRetryDelaySeconds(6), 1920);
  assert.equal(spotifyMonthlyListenerRetryDelaySeconds(7), 3600);
  assert.equal(spotifyMonthlyListenerRetryDelaySeconds(99), 3600);
});

test('monthly listener collection is wired after a confirmed playcount save', () => {
  const router = readFileSync(new URL('../src/spotify-playcount-queue-router.js', import.meta.url), 'utf8');
  const collectIndex = router.indexOf('collectMonthlyListenersAfterPlaycount');
  const refreshIndex = router.indexOf("requestSpotifyReadModelRefresh(env, 'playcount-complete'");
  assert.ok(collectIndex >= 0);
  assert.ok(refreshIndex > collectIndex);
  assert.match(router, /snapshotDate: String\(row\.snapshot_date\)/);
});

test('failed monthly listeners are retried through the Spotify queue until complete', () => {
  const router = readFileSync(new URL('../src/spotify-playcount-queue-router.js', import.meta.url), 'utf8');
  const collector = readFileSync(new URL('../src/spotify-monthly-listeners.js', import.meta.url), 'utf8');
  assert.match(router, /message_type: SPOTIFY_MONTHLY_LISTENERS_TYPE/);
  assert.match(router, /delaySeconds: spotifyMonthlyListenerRetryDelaySeconds\(nextAttempt\)/);
  assert.match(router, /missingOnly: true/);
  assert.match(router, /requestSpotifyReadModelRefresh\(env, 'monthly-listeners-complete'/);
  assert.match(collector, /SPOTIFY_MONTHLY_LISTENER_ARTISTS\.filter/);
});

test('manual monthly listener workflow supports a dated snapshot and read-model refresh', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/collect-spotify-monthly-listeners-manual.yml', import.meta.url),
    'utf8',
  );
  const script = readFileSync(
    new URL('../scripts/collect-spotify-monthly-listeners-actions.mjs', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /snapshot_date:/);
  assert.match(workflow, /default: '2026-10-02'/);
  assert.match(workflow, /collect-spotify-monthly-listeners-actions\.mjs/);
  assert.match(workflow, /bootstrap-spotify-read-model\.mjs/);
  assert.match(script, /SPOTIFY_MONTHLY_SNAPSHOT_DATE/);
  assert.match(script, /SPOTIFY_MONTHLY_LISTENER_ARTISTS/);
});

test('monthly listener table is part of the required Other DB schema', () => {
  const migration = readFileSync(
    new URL('../../database/other-migrations/051_spotify_monthly_listeners_daily.sql', import.meta.url),
    'utf8',
  );
  const tables = readFileSync(new URL('../scripts/other-db-tables.mjs', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_spotify_artist_monthly_listeners_daily/);
  assert.match(migration, /PRIMARY KEY \(snapshot_date, artist_key\)/);
  assert.match(tables, /'sh_spotify_artist_monthly_listeners_daily'/);
});
