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

test('Viral Hits Japan remains distinct from retired Viral 50 and exposes a read-model shard', async () => {
  const { SPOTIFY_JP_CHARTS, spotifyChartModelKey } = await import('../../packages/sh-shared/spotify-charts.mjs');
  const enabled = SPOTIFY_JP_CHARTS.map(spec => spec.id);
  assert.equal(enabled.includes('viral-jp-daily'), false);
  assert.equal(enabled.includes('viral-jp-weekly'), false);
  assert.equal(enabled.includes('viral-hits-jp-daily'), true);
  assert.equal(spotifyChartModelKey('viral-hits-jp-daily', '2026'), 'spotify-charts:viral-hits-jp-daily:2026');
  const { readFileSync } = await import('node:fs');
  const shell = readFileSync(new URL('../public/spotify-charts-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify-charts.js', import.meta.url), 'utf8');
  assert.match(shell, /Viral Hits Japan/);
  assert.match(shell, /掲載順|掲載位置/);
  assert.match(shell, /公式順位ではありません/);
  assert.match(runtime, /type === 'viral-hits' \? '掲載位置'/);
});
