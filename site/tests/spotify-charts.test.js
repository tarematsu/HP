import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet } from '../functions/api/spotify-charts.js';
import { ROUTES, NAVIGATION } from '../public/dashboard-navigation-config.js';
import { spotifyChartYearsForRange } from '../public/spotify-charts-range.js';

test('chart API streams prebuilt index and year models without touching D1', async () => {
  for (const [query, key] of [['', 'spotify-charts'], ['?chart=regional-jp-daily&year=2026', 'spotify-charts:regional-jp-daily:2026']]) {
    const response = await onRequestGet({ request: new Request(`https://example.test/api/spotify-charts${query}`), env: {
      get OTHER_DB() { throw new Error('No D1 in Pages'); },
      PAGES_READ_MODEL_SERVICE: { async fetch(request) {
        assert.equal(new URL(request.url).searchParams.get('key'), key);
        return Response.json({ ok: true, sentinel: key });
      } },
    } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sentinel, key);
  }
  const response = await onRequestGet({ request: new Request('https://example.test/api/spotify-charts?chart=private&year=2026'), env: {} });
  assert.equal(response.status, 400);
});

test('playcounts and charts are independent lazy navigation destinations', () => {
  const sources = NAVIGATION.find(section => section.id === 'subscriptions').sources;
  assert.equal(sources.find(source => source.id === 'spotify').label, 'Spotify 再生数');
  assert.equal(sources.find(source => source.id === 'spotify-charts').label, 'Spotify チャート');
  assert.equal(ROUTES['spotify-charts'].viewId, 'spotifyChartsView');
  assert.notEqual(ROUTES.spotify.viewId, ROUTES['spotify-charts'].viewId);
});

test('year-shard loading respects the selected range and chart source date', () => {
  const state = { latest_chart_date: '2026-02-01', years: ['2019', '2024', '2025', '2026'] };
  assert.deepEqual(spotifyChartYearsForRange(state, '1m'), ['2026']);
  assert.deepEqual(spotifyChartYearsForRange(state, '6m'), ['2025', '2026']);
  assert.deepEqual(spotifyChartYearsForRange(state, '1y'), ['2025', '2026']);
  assert.deepEqual(spotifyChartYearsForRange(state, 'all'), state.years);
  assert.deepEqual(spotifyChartYearsForRange({ ...state, latest_chart_date: null }, '1m'), state.years);
});

test('retired Viral URLs are rejected instead of exposing leftover R2 shards', () => {
  for (const chart of ['viral-jp-daily', 'viral-jp-weekly']) {
    let reads = 0;
    const response = onRequestGet({
      request: new Request(`https://example.test/api/spotify-charts?chart=${chart}&year=2026`),
      env: {
        PAGES_READ_MODEL_SERVICE: { fetch() { reads++; throw new Error('Retired chart must not be fetched'); } },
      },
    });
    assert.equal(response.status, 400);
    assert.equal(reads, 0);
  }
});

test('Spotify Charts shell excludes discontinued Viral panels', async () => {
  const { readFileSync } = await import('node:fs');
  const shell = readFileSync(new URL('../public/spotify-charts-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify-charts.js', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /(?:^|[, {])viral:\s*['\"]/);
  assert.doesNotMatch(runtime, /'viral'/);
});

test('all 16 Spotify editorial playlists live in a separate navigation route', async () => {
  const { SPOTIFY_JP_CHARTS, SPOTIFY_CHART_SOURCES, SPOTIFY_EDITORIAL_PLAYLISTS, spotifyChartModelKey } =
    await import('../../packages/sh-shared/spotify-charts.mjs');
  const { SPOTIFY_PLAYLIST_TABS } = await import('../public/spotify-playlists-catalog.js');
  assert.equal(SPOTIFY_JP_CHARTS.length, 5);
  assert.equal(SPOTIFY_EDITORIAL_PLAYLISTS.length, 16);
  assert.equal(SPOTIFY_CHART_SOURCES.length, 21);
  assert.deepEqual(SPOTIFY_PLAYLIST_TABS.map(tab => tab.chartId), SPOTIFY_EDITORIAL_PLAYLISTS.map(spec => spec.id));
  assert.equal(new Set(SPOTIFY_EDITORIAL_PLAYLISTS.map(spec => spec.playlistId)).size, 16);
  assert.equal(spotifyChartModelKey('viral-hits-jp-daily', '2026'), 'spotify-charts:viral-hits-jp-daily:2026');
  assert.equal(spotifyChartModelKey('viral-jp-weekly', '2026'), null);
  const sources = NAVIGATION.find(section => section.id === 'subscriptions').sources;
  assert.equal(sources.find(source => source.id === 'spotify-playlists')?.label, 'Spotify プレイリスト');
  assert.equal(ROUTES['spotify-playlists'].viewId, 'spotifyPlaylistsView');
  assert.notEqual(ROUTES['spotify-playlists'].viewId, ROUTES['spotify-charts'].viewId);
  const { readFileSync } = await import('node:fs');
  const chartShell = readFileSync(new URL('../public/spotify-charts-shell.js', import.meta.url), 'utf8');
  const playlistShell = readFileSync(new URL('../public/spotify-playlists-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify-charts.js', import.meta.url), 'utf8');
  assert.doesNotMatch(chartShell, /Viral Hits Japan/);
  assert.match(playlistShell, /SPOTIFY_PLAYLIST_TABS/);
  assert.match(playlistShell, /掲載位置/);
  assert.match(runtime, /loadSpotifyPlaylistsView/);
});

test('playlist year shards are accepted only for registered IDs', async () => {
  const response = await onRequestGet({
    request: new Request('https://example.test/api/spotify-charts?chart=playlist-idol-pop-japan-daily&year=2026'),
    env: { PAGES_READ_MODEL_SERVICE: { fetch(request) {
      assert.equal(new URL(request.url).searchParams.get('key'), 'spotify-charts:playlist-idol-pop-japan-daily:2026');
      return Response.json({ ok: true });
    } } },
  });
  assert.equal(response.status, 200);
});
