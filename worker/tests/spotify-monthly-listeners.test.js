import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  monthlyListenersFromArtistOverview,
  spotifyArtistOverviewUrl,
  spotifyMonthlyListenersReadModelSourceSql,
} from '../src/spotify-monthly-listeners.js';

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

test('monthly listener collection is wired after a confirmed playcount save', () => {
  const router = readFileSync(new URL('../src/spotify-playcount-queue-router.js', import.meta.url), 'utf8');
  const collectIndex = router.indexOf('collectSpotifyMonthlyListeners');
  const refreshIndex = router.indexOf("requestSpotifyReadModelRefresh(env, 'playcount-complete'");
  assert.ok(collectIndex >= 0);
  assert.ok(refreshIndex > collectIndex);
  assert.match(router, /snapshotDate: String\(row\.snapshot_date\)/);
});

test('monthly listener collection materializes the display join once', () => {
  const sql = spotifyMonthlyListenersReadModelSourceSql();
  assert.match(sql, /FROM sh_spotify_artist_monthly_listeners_daily daily/);
  assert.match(sql, /INNER JOIN sh_spotify_artists artist/);
  assert.match(sql, /current_rank\.rank AS current_rank/);
  const source = readFileSync(new URL('../src/spotify-monthly-listeners.js', import.meta.url), 'utf8');
  assert.match(source, /INSERT INTO sh_spotify_monthly_listeners_read_model/);
  assert.match(source, /refreshSpotifyMonthlyListenersReadModel/);
});

test('monthly listener tables are part of the required Other DB schema', () => {
  const dailyMigration = readFileSync(
    new URL('../../database/other-migrations/051_spotify_monthly_listeners_daily.sql', import.meta.url),
    'utf8',
  );
  const readModelMigration = readFileSync(
    new URL('../../database/other-migrations/062_spotify_monthly_listeners_read_model.sql', import.meta.url),
    'utf8',
  );
  const tables = readFileSync(new URL('../scripts/other-db-tables.mjs', import.meta.url), 'utf8');
  assert.match(dailyMigration, /CREATE TABLE IF NOT EXISTS sh_spotify_artist_monthly_listeners_daily/);
  assert.match(dailyMigration, /PRIMARY KEY \(snapshot_date, artist_key\)/);
  assert.match(readModelMigration, /CREATE TABLE IF NOT EXISTS sh_spotify_monthly_listeners_read_model/);
  assert.match(readModelMigration, /rows_json TEXT NOT NULL/);
  assert.match(tables, /'sh_spotify_artist_monthly_listeners_daily'/);
  assert.match(tables, /'sh_spotify_monthly_listeners_read_model'/);
});
