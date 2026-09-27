import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  onRequestGet,
  spotifyArtist,
  spotifyPlaycountSql,
  spotifyReadModel,
  spotifyTrendSql,
} from '../functions/api/spotify-playcounts.js';
import {
  canonicalApiCacheRequest,
  materializedApiKey,
} from '../functions/lib/api-contract.js';

function mockDb({ latestRows = [], trendRows = [] }) {
  return {
    prepare(sql) {
      const rows = sql === spotifyPlaycountSql()
        ? latestRows
        : sql === spotifyTrendSql()
          ? trendRows
          : null;
      assert.notEqual(rows, null, `unexpected SQL: ${sql}`);
      return {
        async all() {
          return { results: rows };
        },
      };
    },
  };
}

function row(artistKey, trackId, playcount, delta, snapshotDate = '2026-09-27') {
  return {
    artist_key: artistKey,
    snapshot_date: snapshotDate,
    track_id: trackId,
    name: `Song ${trackId}`,
    playcount,
    delta,
    collected_at: 1_800_000_000_000,
    is_carried_forward: 0,
  };
}

function trendRow(
  artistKey,
  snapshotDate,
  totalDelta,
  trackCount = 1,
  carriedForward = 0,
  artistName = artistKey,
  currentRank = null,
) {
  return {
    artist_key: artistKey,
    artist_name: artistName,
    current_rank: currentRank,
    snapshot_date: snapshotDate,
    total_delta: totalDelta,
    track_count: trackCount,
    is_carried_forward: carriedForward,
  };
}

test('Spotify artist helpers keep the three table groups', () => {
  assert.deepEqual(spotifyArtist(), { key: 'sakurazaka46', name: '櫻坂46' });
  assert.deepEqual(spotifyArtist('nogizaka46'), { key: 'nogizaka46', name: '乃木坂46' });
  assert.deepEqual(spotifyArtist('hinatazaka46'), { key: 'hinatazaka46', name: '日向坂46' });
  assert.equal(spotifyArtist('unknown'), null);
});

test('Spotify read model keeps three table groups and expands trend to tracked female idols', () => {
  const model = spotifyReadModel([
    row('nogizaka46', 'n1', 1000, 100),
    row('nogizaka46', 'n2', 900, 90),
    row('sakurazaka46', 's1', 1200, 120),
    row('hinatazaka46', 'h1', 800, 80),
  ], [
    trendRow('equal-love', '2026-09-26', 210, 2, 0, '＝LOVE', 1),
    trendRow('equal-love', '2026-09-27', 220, 2, 0, '＝LOVE', 1),
    trendRow('nogizaka46', '2026-09-26', 180, 2, 0, '乃木坂46', 5),
    trendRow('nogizaka46', '2026-09-27', 190, 2, 0, '乃木坂46', 5),
    trendRow('sakurazaka46', '2026-09-26', 110, 1, 0, '櫻坂46', 16),
    trendRow('sakurazaka46', '2026-09-27', 120, 1, 0, '櫻坂46', 16),
    trendRow('hinatazaka46', '2026-09-26', 70, 1, 0, '日向坂46', 18),
    trendRow('hinatazaka46', '2026-09-27', 80, 1, 0, '日向坂46', 18),
  ]);
  assert.equal(model.default_artist, 'sakurazaka46');
  assert.equal(model.groups.nogizaka46.track_count, 2);
  assert.equal(model.groups.nogizaka46.total_delta, 190);
  assert.deepEqual(
    model.trend['equal-love'].map((item) => [item.snapshot_date, item.total_delta]),
    [['2026-09-26', 210], ['2026-09-27', 220]],
  );
  assert.equal(model.trend['equal-love'][0].artist_name, '＝LOVE');
  assert.equal(model.trend['equal-love'][0].current_rank, 1);
  assert.equal(model.trend.sakurazaka46.at(-1).total_delta, 120);
});

test('Spotify trend SQL covers the additive tracked-idol roster for the latest 90 days', () => {
  const sql = spotifyTrendSql();
  assert.match(sql, /-89 days/);
  assert.match(sql, /INNER JOIN sh_spotify_artists artist/);
  assert.match(sql, /sh_spotify_top20_history/);
  assert.match(sql, /GROUP BY target\.artist_key, artist\.artist_name, current_rank\.rank, d\.snapshot_date/);
  assert.match(sql, /SUM\(d\.delta\)/);
  assert.doesNotMatch(sql, /target\.artist_key IN \('nogizaka46','sakurazaka46','hinatazaka46'\)/);
});

test('Spotify API builds one complete read model for R2 publication', async () => {
  const response = await onRequestGet({
    env: {
      OTHER_DB: mockDb({
        latestRows: [
          row('nogizaka46', 'n1', 100, 5),
          row('sakurazaka46', 's1', 200, 10),
          row('hinatazaka46', 'h1', 300, 15),
        ],
        trendRows: [
          trendRow('equal-love', '2026-09-27', 25, 1, 0, '＝LOVE', 1),
          trendRow('nogizaka46', '2026-09-26', 4, 1, 0, '乃木坂46', 5),
          trendRow('nogizaka46', '2026-09-27', 5, 1, 0, '乃木坂46', 5),
          trendRow('sakurazaka46', '2026-09-26', 8, 1, 0, '櫻坂46', 16),
          trendRow('sakurazaka46', '2026-09-27', 10, 1, 0, '櫻坂46', 16),
          trendRow('hinatazaka46', '2026-09-26', 12, 1, 0, '日向坂46', 18),
          trendRow('hinatazaka46', '2026-09-27', 15, 1, 0, '日向坂46', 18),
        ],
      }),
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.groups.sakurazaka46.tracks[0].playcount, 200);
  assert.equal(payload.trend.nogizaka46.length, 2);
  assert.equal(payload.trend['equal-love'][0].artist_name, '＝LOVE');
  assert.equal(payload.trend.sakurazaka46.at(-1).total_delta, 10);
});

test('Spotify public API variants resolve to one materialized R2 model and one cache key', () => {
  assert.equal(materializedApiKey(new URL('https://skrzk.test/api/spotify-playcounts')), 'spotify-playcounts');
  assert.equal(
    materializedApiKey(new URL('https://skrzk.test/api/spotify-playcounts?artist=nogizaka46')),
    'spotify-playcounts',
  );
  const plain = canonicalApiCacheRequest(new Request('https://skrzk.test/api/spotify-playcounts')).url;
  const legacy = canonicalApiCacheRequest(new Request('https://skrzk.test/api/spotify-playcounts?artist=hinatazaka46')).url;
  assert.equal(legacy, plain);
});

test('Spotify API reports missing D1 only on the read-model producer path', async () => {
  const missing = await onRequestGet({ env: {} });
  assert.equal(missing.status, 503);
});

test('Spotify tab renders every tracked female idol in one shared trend graph', () => {
  const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/spotify.css', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

  assert.match(shell, /data-view = 'spotify'|dataset\.view = 'spotify'/);
  assert.match(shell, /data-spotify-artist="nogizaka46"/);
  assert.match(shell, /data-spotify-artist="sakurazaka46" class="active" aria-pressed="true"/);
  assert.match(shell, /data-spotify-artist="hinatazaka46"/);
  assert.match(shell, /id="spotifyTrendCharts"/);
  assert.match(shell, /女性アイドルSpotify再生数推移/);
  assert.match(shell, /FEMALE IDOLS/);
  assert.match(shell, /全アーティストの日別前回比合計を重ねたグラフ/);
  assert.match(shell, /spotify\.css\?v=20260928\.3/);
  assert.doesNotMatch(runtime, /TREND_ORDER/);
  assert.match(runtime, /Object\.entries\(trend \|\| \{\}\)/);
  assert.match(runtime, /currentRank/);
  assert.match(runtime, /TREND_COLORS/);
  assert.match(runtime, /spotify-trend-combined/);
  assert.match(runtime, /spotify-trend-legend/);
  assert.match(runtime, /chart\.append\(legend, scroll\)/);
  assert.match(runtime, /container\.append\(chart\)/);
  assert.match(runtime, /path\.style\.setProperty\('--spotify-trend-color'/);
  assert.match(runtime, /circle\.style\.setProperty\('--spotify-trend-color'/);
  assert.doesNotMatch(runtime, /container\.append\(series\)/);
  assert.match(styles, /\.spotify-trend-legend/);
  assert.match(styles, /aspect-ratio: 960 \/ 340/);
  assert.match(runtime, /fetch\('\/api\/spotify-playcounts'\)/);
  assert.doesNotMatch(runtime, /spotify-playcounts\?artist=/);
  assert.match(runtime, /model\?\.trend/);
  assert.match(runtime, /model\?\.groups\?\.\[requested\]/);
  assert.match(tabs, /VIEW_MODES[\s\S]*'spotify'/);
  assert.match(tabs, /const spotifyView = document\.getElementById\('spotifyView'\)/);
  assert.match(tabs, /async function showSpotify/);
  assert.match(tabs, /import\('\/spotify\.js\?v=20260928\.3'\)/);
  assert.match(tabs, /else if \(mode === 'spotify'\) void showSpotify/);
  assert.match(tabs, /button\.dataset\.view === 'spotify'/);
  assert.match(dashboard, /spotify-shell\.js\?v=20260928\.3/);
  assert.match(dashboard, /dashboard-tabs\.js\?v=20260928\.2/);
  assert.doesNotMatch(dashboard, /spotify-tab-router/);
});