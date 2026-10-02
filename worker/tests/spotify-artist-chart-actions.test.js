import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  normalizeSpotifyArtistChart,
  refreshSpotifyChartsAccessToken,
  updateSpotifyRefreshWorkerSecret,
} from '../src/spotify-artist-chart-collector.js';
import { shouldDispatchSpotifyArtistChart } from '../src/spotify-playcount-timing.js';

const bootstrapPath = new URL('../scripts/bootstrap-spotify-charts-refresh.py', import.meta.url);
const workflowPath = new URL('../../.github/workflows/collect-spotify-artist-chart.yml', import.meta.url);
const collectorPath = new URL('../src/spotify-artist-chart-collector.js', import.meta.url);
const storePath = new URL('../scripts/store-spotify-charts-worker-secrets.mjs', import.meta.url);

function atJst(hour, minute) {
  return Date.UTC(2026, 9, 3, (hour + 15) % 24, minute, 0);
}

test('one-time Spotify bootstrap is valid Python and uses PKCE without browser automation', () => {
  execFileSync('python3', ['-m', 'py_compile', bootstrapPath.pathname]);
  const source = readFileSync(bootstrapPath, 'utf8');
  assert.match(source, /oauth2\/v2\/auth/);
  assert.match(source, /code_challenge_method/);
  assert.match(source, /refresh_token/);
  assert.match(source, /SPOTIFY_CHARTS_SP_DC/);
  assert.doesNotMatch(source, /WebView2|selenium|playwright|puppeteer/i);
});

test('Daily Top Artist is retried hourly from 07:20 through 11:20 JST', () => {
  assert.equal(shouldDispatchSpotifyArtistChart(atJst(7, 20)), true);
  assert.equal(shouldDispatchSpotifyArtistChart(atJst(9, 20)), true);
  assert.equal(shouldDispatchSpotifyArtistChart(atJst(11, 20)), true);
  assert.equal(shouldDispatchSpotifyArtistChart(atJst(7, 10)), false);
  assert.equal(shouldDispatchSpotifyArtistChart(atJst(12, 20)), false);
});

test('Spotify PKCE refresh rotates the Cloudflare Worker secret only when Spotify returns a new token', async () => {
  const tokenCalls = [];
  const refreshed = await refreshSpotifyChartsAccessToken('old-refresh', async (url, init) => {
    tokenCalls.push({ url, init });
    return new Response(JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(refreshed.rotated, true);
  assert.equal(refreshed.refresh_token, 'new-refresh');
  assert.equal(tokenCalls.length, 1);

  const secretCalls = [];
  await updateSpotifyRefreshWorkerSecret({
    CLOUDFLARE_WORKER_SECRET_TOKEN: 'cf-token',
    CLOUDFLARE_WORKER_SECRET_ACCOUNT_ID: 'account-id',
  }, 'new-refresh', async (url, init) => {
    secretCalls.push({ url, init });
    return new Response(JSON.stringify({ success: true, result: { name: 'SPOTIFY_CHARTS_REFRESH_TOKEN' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  assert.equal(secretCalls.length, 1);
  assert.match(secretCalls[0].url, /workers\/scripts\/sh-spotify-playcount-collector\/secrets$/);
  assert.deepEqual(JSON.parse(secretCalls[0].init.body), {
    name: 'SPOTIFY_CHARTS_REFRESH_TOKEN',
    text: 'new-refresh',
    type: 'secret_text',
  });
});

test('chart payload normalization keeps rank metadata for the existing D1 model', () => {
  const entries = Array.from({ length: 50 }, (_, index) => ({
    chartEntryData: {
      currentRank: index + 1,
      previousRank: index + 2,
      peakRank: 1,
      consecutiveAppearancesOnChart: 3,
    },
    artistMetadata: {
      artistName: `Artist ${index}`,
      artistUri: `spotify:artist:ArtistId${String(index).padStart(10, '0')}`,
    },
  }));
  const normalized = normalizeSpotifyArtistChart({ chartDate: '2026-10-02', entries }, 12345);
  assert.equal(normalized.chart_date, '2026-10-02');
  assert.equal(normalized.entries.length, 50);
  assert.equal(normalized.entries[0].rank, 1);
  assert.equal(normalized.entries[0].previous_rank, 2);
});

test('GitHub Action is bootstrap-only and Cloudflare Worker owns recurring collection', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const collector = readFileSync(collectorPath, 'utf8');
  const store = readFileSync(storePath, 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
  assert.match(workflow, /bootstrap-spotify-charts-refresh\.py/);
  assert.match(workflow, /store-spotify-charts-worker-secrets\.mjs/);
  assert.match(collector, /SPOTIFY_CHARTS_REFRESH_TOKEN/);
  assert.match(collector, /CLOUDFLARE_WORKER_SECRET_TOKEN/);
  assert.match(collector, /publishSpotifyPagesReadModel/);
  assert.match(store, /CLOUDFLARE_API_TOKEN/);
  assert.match(store, /Workers\/scripts/i);
});
