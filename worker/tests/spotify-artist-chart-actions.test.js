import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  matchSpotifyArtistChartEntries,
  validateSpotifyArtistChartCapture,
} from '../scripts/persist-spotify-artist-chart-actions.mjs';

const pythonPath = new URL('../scripts/collect-spotify-artist-chart-actions.py', import.meta.url);
const workflowPath = new URL('../../.github/workflows/collect-spotify-artist-chart.yml', import.meta.url);
const refreshPath = new URL('../scripts/refresh-spotify-read-model-actions.mjs', import.meta.url);

function capture(entries = []) {
  const filler = Array.from({ length: Math.max(0, 50 - entries.length) }, (_, index) => ({
    rank: entries.length + index + 1,
    artist_name: `Other ${index}`,
    artist_id: `ArtistId${String(index).padStart(10, '0')}`,
  }));
  return {
    version: 1,
    chart_id: 'artist-jp-daily',
    chart_date: '2026-10-02',
    observed_at: 1_800_000_000_000,
    received_at: 1_800_000_000_000,
    entries: [...entries, ...filler],
  };
}

test('browserless Spotify chart fetcher is valid Python and uses PKCE rather than WebView', () => {
  execFileSync('python3', ['-m', 'py_compile', pythonPath.pathname]);
  const source = readFileSync(pythonPath, 'utf8');
  assert.match(source, /oauth2\/v2\/auth/);
  assert.match(source, /code_challenge_method/);
  assert.match(source, /SPOTIFY_CHARTS_SP_DC/);
  assert.match(source, /charts-spotify-com-service\.spotify\.com\/auth\/v0\/charts\/artist-jp-daily\/latest/);
  assert.doesNotMatch(source, /WebView2|selenium|playwright|puppeteer/i);
});

test('artist chart normalization matches tracked artists by Spotify ID before name', () => {
  const normalized = validateSpotifyArtistChartCapture(capture([
    { rank: 5, artist_name: '別名', artist_id: '08lN7bm4Etec8ETFxaTUmq' },
    { rank: 16, artist_name: '櫻坂46', artist_id: '0Ti7MfCiVVQAK8zLSiqlto' },
  ]));
  const matched = matchSpotifyArtistChartEntries(normalized, [
    { artist_key: 'nogizaka46', artist_name: '乃木坂46', spotify_artist_id: '08lN7bm4Etec8ETFxaTUmq' },
    { artist_key: 'sakurazaka46', artist_name: '櫻坂46', spotify_artist_id: '0Ti7MfCiVVQAK8zLSiqlto' },
  ]);
  assert.deepEqual(matched.map(({ artist, entry }) => [artist.artist_key, entry.rank]), [
    ['nogizaka46', 5],
    ['sakurazaka46', 16],
  ]);
});

test('Daily Top Artist workflow is once daily at 07:20 JST and refreshes the canonical Spotify model', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const refresh = readFileSync(refreshPath, 'utf8');
  assert.match(workflow, /cron: '20 22 \* \* \*'/);
  assert.match(workflow, /SPOTIFY_CHARTS_SP_DC/);
  assert.match(workflow, /curl-cffi==0\.16\.3/);
  assert.match(workflow, /persist-spotify-artist-chart-actions\.mjs/);
  assert.match(workflow, /refresh-spotify-read-model-actions\.mjs/);
  assert.match(refresh, /publishSpotifyPagesReadModel/);
  assert.match(refresh, /PAGES_RESPONSE_R2/);
});
