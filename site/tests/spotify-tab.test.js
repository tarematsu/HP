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
  artistName = artistKey,
  currentRank = null,
) {
  return {
    artist_key: artistKey,
    artist_name: artistName,
    current_rank: currentRank,
    snapshot_date: snapshotDate,
    total_delta: totalDelta,
  };
}

test('Spotify detail artist is fixed to Sakurazaka', () => {
  assert.deepEqual(spotifyArtist(), { key: 'sakurazaka46', name: '櫻坂46' });
  assert.deepEqual(spotifyArtist('sakurazaka46'), { key: 'sakurazaka46', name: '櫻坂46' });
  assert.equal(spotifyArtist('nogizaka46'), null);
  assert.equal(spotifyArtist('hinatazaka46'), null);
  assert.equal(spotifyArtist('unknown'), null);
});

test('Spotify read model keeps only Sakurazaka track detail and all-idol trend totals', () => {
  const model = spotifyReadModel([
    row('nogizaka46', 'n1', 1000, 100),
    row('sakurazaka46', 's1', 1200, 120),
    row('hinatazaka46', 'h1', 800, 80),
  ], [
    trendRow('equal-love', '2026-09-26', 210, '＝LOVE', 1),
    trendRow('equal-love', '2026-09-27', 220, '＝LOVE', 1),
    trendRow('nogizaka46', '2026-09-27', 190, '乃木坂46', 5),
    trendRow('sakurazaka46', '2026-09-27', 120, '櫻坂46', 16),
    trendRow('hinatazaka46', '2026-09-27', 80, '日向坂46', 18),
  ]);
  assert.equal(model.default_artist, 'sakurazaka46');
  assert.deepEqual(Object.keys(model.groups), ['sakurazaka46']);
  assert.equal(model.groups.sakurazaka46.track_count, 1);
  assert.equal(model.groups.sakurazaka46.total_delta, 120);
  assert.deepEqual(
    model.trend['equal-love'].map((item) => [item.snapshot_date, item.total_delta]),
    [['2026-09-26', 210], ['2026-09-27', 220]],
  );
  assert.deepEqual(Object.keys(model.trend['equal-love'][0]).sort(), [
    'artist_name', 'current_rank', 'snapshot_date', 'total_delta',
  ]);
  assert.equal(model.trend['equal-love'][0].artist_name, '＝LOVE');
  assert.equal(model.trend['equal-love'][0].current_rank, 1);
});

test('Spotify detail SQL reads only Sakurazaka while trend SQL uses the bounded artist-day summary', () => {
  const detailSql = spotifyPlaycountSql();
  assert.match(detailSql, /target\.artist_key='sakurazaka46'/);
  assert.doesNotMatch(detailSql, /nogizaka46|hinatazaka46/);

  const trendSql = spotifyTrendSql();
  assert.match(trendSql, /-89 days/);
  assert.match(trendSql, /FROM sh_spotify_artist_daily daily/);
  assert.match(trendSql, /latest_summary_date/);
  assert.match(trendSql, /INNER JOIN sh_spotify_artists artist/);
  assert.match(trendSql, /sh_spotify_top20_history/);
  assert.match(trendSql, /daily\.total_delta/);
  assert.doesNotMatch(trendSql, /sh_spotify_playcount_daily|GROUP BY|SUM\(d\.delta\)/);
  assert.doesNotMatch(trendSql, /target\.artist_key IN/);
});

test('Spotify API publishes Sakurazaka detail plus all-idol trend summary', async () => {
  const response = await onRequestGet({
    env: {
      OTHER_DB: mockDb({
        latestRows: [
          row('nogizaka46', 'n1', 100, 5),
          row('sakurazaka46', 's1', 200, 10),
          row('hinatazaka46', 'h1', 300, 15),
        ],
        trendRows: [
          trendRow('equal-love', '2026-09-27', 25, '＝LOVE', 1),
          trendRow('nogizaka46', '2026-09-27', 5, '乃木坂46', 5),
          trendRow('sakurazaka46', '2026-09-27', 10, '櫻坂46', 16),
          trendRow('hinatazaka46', '2026-09-27', 15, '日向坂46', 18),
        ],
      }),
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(Object.keys(payload.groups), ['sakurazaka46']);
  assert.equal(payload.groups.sakurazaka46.tracks[0].playcount, 200);
  assert.equal(payload.trend.nogizaka46.length, 1);
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

test('Spotify tab has one all-idol trend graph and a fixed Sakurazaka detail table', () => {
  const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/spotify.css', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

  assert.match(shell, /data-view = 'spotify'|dataset\.view = 'spotify'/);
  assert.doesNotMatch(shell, /data-spotify-artist|spotify-artist-switch/);
  assert.match(shell, /櫻坂46 Spotify再生数概要/);
  assert.match(shell, /<h2 id="spotifyTableTitle">櫻坂46 再生数一覧<\/h2>/);
  assert.match(shell, /id="spotifyTrendCharts"/);
  assert.match(shell, /女性アイドルSpotify再生数推移/);
  assert.match(shell, /全アーティストの日別前回比合計を重ねたグラフ/);
  assert.match(shell, /spotify\.css\?v=20260928\.3/);

  assert.match(runtime, /SAKURAZAKA_KEY = 'sakurazaka46'/);
  assert.doesNotMatch(runtime, /activeArtist|updateArtistButtons|data-spotify-artist/);
  assert.match(runtime, /Object\.entries\(trend \|\| \{\}\)/);
  assert.match(runtime, /spotify-trend-combined/);
  assert.match(runtime, /spotify-trend-legend/);
  assert.match(runtime, /chart\.append\(legend, scroll\)/);
  assert.match(runtime, /container\.append\(chart\)/);
  assert.match(runtime, /model\?\.groups\?\.\[SAKURAZAKA_KEY\]/);
  assert.match(runtime, /model\?\.trend/);
  assert.match(runtime, /fetch\('\/api\/spotify-playcounts'\)/);
  assert.doesNotMatch(runtime, /spotify-playcounts\?artist=/);

  assert.doesNotMatch(styles, /spotify-artist-switch/);
  assert.match(styles, /\.spotify-trend-legend/);
  assert.match(styles, /aspect-ratio: 960 \/ 340/);
  assert.match(tabs, /import\('\/spotify\.js\?v=20260928\.3'\)/);
  assert.match(dashboard, /spotify-shell\.js\?v=20260928\.3/);
  assert.match(dashboard, /dashboard-tabs\.js\?v=20260928\.2/);
});
