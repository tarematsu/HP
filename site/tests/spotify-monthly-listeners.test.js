import { modelBucket } from './helpers/model-bucket.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  onRequestGet,
  spotifyMonthlyListenersSql,
  spotifyMonthlyListenersTrend,
} from '../../worker/src/pages-query-api-spotify-monthly-listeners.js';

test('monthly listener materializer reads the dedicated daily table', () => {
  const sql = spotifyMonthlyListenersSql();
  assert.match(sql, /FROM sh_spotify_artist_monthly_listeners_daily daily/);
  assert.match(sql, /INNER JOIN sh_spotify_artists artist/);
  assert.match(sql, /current_rank\.rank AS current_rank/);
});

test('public monthly listener API is storage-only and does not query D1', () => {
  const source = readFileSync(new URL('../../worker/src/pages-query-api-spotify-monthly-listeners.js', import.meta.url), 'utf8');
  const readModelService = readFileSync(new URL('../functions/lib/pages-read-model-service.js', import.meta.url), 'utf8');
  assert.match(source, /fetchPagesReadModel\(env, 'spotify-playcounts'\)/);
  assert.match(readModelService, /PAGES_READ_MODEL_SERVICE/);
  assert.match(readModelService, /_internal\/pages-response/);
  assert.doesNotMatch(source, /OTHER_DB|\.prepare\(/);
  assert.doesNotMatch(source, /image\/svg\+xml|spotifyMonthlyListenersSvg|format === 'svg'/);
});

test('monthly listener trend keeps valid nonnegative daily snapshots', () => {
  const payload = spotifyMonthlyListenersTrend([
    {
      snapshot_date: '2026-10-01', artist_key: 'mei', artist_name: 'ME:I',
      monthly_listeners: 450738, collected_at: 1000, current_rank: 12,
    },
    {
      snapshot_date: 'bad-date', artist_key: 'mei', artist_name: 'ME:I',
      monthly_listeners: 999999, collected_at: 1001, current_rank: 12,
    },
  ]);
  assert.equal(payload.latest_snapshot_date, '2026-10-01');
  assert.deepEqual(payload.trend.mei, [{
    snapshot_date: '2026-10-01',
    artist_name: 'ME:I',
    current_rank: 12,
    monthly_listeners: 450738,
    collected_at: 1000,
  }]);
});

test('monthly listener endpoint returns JSON even when a legacy format query is present', async () => {
  const rows = [
    {
      snapshot_date: '2026-10-01', artist_key: 'sakurazaka46', artist_name: '櫻坂46',
      monthly_listeners: 450738, collected_at: 1000, current_rank: 12,
    },
  ];
  const response = await onRequestGet({
    env: {
      PAGES_RESPONSE_R2: modelBucket({
        async fetch() {
          return new Response(JSON.stringify({ monthly_listener_rows: rows }), {
            headers: { 'content-type': 'application/json' },
          });
        },
      }),
    },
    request: new Request('https://skrzk.test/api/spotify-monthly-listeners?format=svg'),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.trend.sakurazaka46[0].monthly_listeners, 450738);
});

test('Spotify monthly listeners move to the chart view and share the metric renderer', () => {
  const shell = readFileSync(new URL('../public/spotify-charts-shell.js', import.meta.url), 'utf8');
  const plays = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify-charts.js', import.meta.url), 'utf8');
  assert.match(shell, /月間リスナー推移/);
  assert.match(shell, /spotifyChartsListenersBody/);
  assert.doesNotMatch(plays, /月間リスナー/);
  assert.match(runtime, /spotify-trend-chart/);
  assert.match(runtime, /renderTrendChart\(monthlyListenerTrend\(monthlyRows\)/);
});
