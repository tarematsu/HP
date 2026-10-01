import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  selectMonthlyListenerSeries,
  spotifyMonthlyListenersReadModelSql,
  spotifyMonthlyListenersSql,
  spotifyMonthlyListenersSvg,
  spotifyMonthlyListenersTrend,
} from '../functions/api/spotify-monthly-listeners.js';

test('monthly listener API reads one materialized row in steady state', () => {
  const sql = spotifyMonthlyListenersReadModelSql();
  assert.match(sql, /FROM sh_spotify_monthly_listeners_read_model/);
  assert.match(sql, /model_key='current'/);
  assert.match(sql, /LIMIT 1/);
});

test('monthly listener legacy SQL remains only as rolling-migration fallback', () => {
  const sql = spotifyMonthlyListenersSql();
  assert.match(sql, /FROM sh_spotify_artist_monthly_listeners_daily daily/);
  assert.match(sql, /INNER JOIN sh_spotify_artists artist/);
  assert.match(sql, /current_rank\.rank AS current_rank/);
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

test('monthly listener chart selects the latest top ten instead of historical maxima', () => {
  const trend = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
    `artist-${index}`,
    [
      { snapshot_date: '2026-10-01', artist_name: `Artist ${index}`, monthly_listeners: 1000000 - index },
      { snapshot_date: '2026-10-02', artist_name: `Artist ${index}`, monthly_listeners: index * 1000 },
    ],
  ]));
  const selected = selectMonthlyListenerSeries(trend, 10);
  assert.equal(selected.length, 10);
  assert.equal(selected[0].artistKey, 'artist-11');
  assert.equal(selected.at(-1).artistKey, 'artist-2');
});

test('monthly listener endpoint can render the graph as SVG', () => {
  const svg = spotifyMonthlyListenersSvg([
    { snapshot_date: '2026-10-01', artist_key: 'mei', artist_name: 'ME:I', monthly_listeners: 450000 },
    { snapshot_date: '2026-10-02', artist_key: 'mei', artist_name: 'ME:I', monthly_listeners: 450738 },
  ]);
  assert.match(svg, /^<svg/);
  assert.match(svg, /ME:I/);
  assert.match(svg, /polyline/);
  assert.match(svg, /450,738/);
});

test('Spotify shell mounts the server-rendered monthly listener chart', () => {
  const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
  assert.match(shell, /Spotify 月間リスナー推移（上位10組）/);
  assert.match(shell, /\/api\/spotify-monthly-listeners\?format=svg/);
  assert.match(shell, /class="chart-fit"/);
  assert.doesNotMatch(shell, /initSpotifyMonthlyListeners/);
});
