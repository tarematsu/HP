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
      return { async all() { return { results: rows }; } };
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
  top10Delta = null,
  top10YearDelta = null,
) {
  return {
    artist_key: artistKey,
    artist_name: artistName,
    current_rank: currentRank,
    snapshot_date: snapshotDate,
    total_delta: totalDelta,
    top10_delta: top10Delta,
    top10_year_delta: top10YearDelta,
  };
}

test('Spotify detail artist is fixed to Sakurazaka', () => {
  assert.deepEqual(spotifyArtist(), { key: 'sakurazaka46', name: '櫻坂46' });
  assert.deepEqual(spotifyArtist('sakurazaka46'), { key: 'sakurazaka46', name: '櫻坂46' });
  assert.equal(spotifyArtist('nogizaka46'), null);
  assert.equal(spotifyArtist('hinatazaka46'), null);
  assert.equal(spotifyArtist('unknown'), null);
});

test('Spotify read model keeps Sakurazaka detail and all three all-idol trend metrics', () => {
  const model = spotifyReadModel([
    row('nogizaka46', 'n1', 1000, 100),
    row('sakurazaka46', 's1', 1200, 120),
    row('hinatazaka46', 'h1', 800, 80),
  ], [
    trendRow('equal-love', '2026-09-26', 210, '＝LOVE', 1, 180, 70),
    trendRow('equal-love', '2026-09-27', 220, '＝LOVE', 1, 190, 80),
    trendRow('sakurazaka46', '2026-09-27', 120, '櫻坂46', 16, 110, 50),
  ]);

  assert.deepEqual(Object.keys(model.groups), ['sakurazaka46']);
  assert.equal(model.groups.sakurazaka46.track_count, 1);
  assert.equal(model.groups.sakurazaka46.total_delta, 120);
  assert.deepEqual(
    model.trend['equal-love'].map((item) => [
      item.snapshot_date,
      item.total_delta,
      item.top10_delta,
      item.top10_year_delta,
    ]),
    [
      ['2026-09-26', 210, 180, 70],
      ['2026-09-27', 220, 190, 80],
    ],
  );
  assert.deepEqual(Object.keys(model.trend['equal-love'][0]).sort(), [
    'artist_name',
    'current_rank',
    'snapshot_date',
    'top10_delta',
    'top10_year_delta',
    'total_delta',
  ]);
});

test('Spotify detail merges duplicate editions and sorts by delta after dedupe', () => {
  const first = row('sakurazaka46', 'single-id', 9_386_149, 3_991);
  first.name = '自業自得';
  const second = row('sakurazaka46', 'album-id', 9_386_149, 3_991);
  second.name = ' 自業自得　';
  const third = row('sakurazaka46', 'other-id', 8_781_230, 3_847);
  third.name = '承認欲求';
  const payload = spotifyReadModel([third, second, first], []).groups.sakurazaka46;

  assert.equal(payload.track_count, 2);
  assert.deepEqual(payload.tracks.map((track) => track.name), ['自業自得', '承認欲求']);
  assert.equal(payload.total_delta, 3_991 + 3_847);
  assert.deepEqual(payload.tracks.map((track) => track.rank), [1, 2]);
});

test('Spotify trend SQL reads only the compact artist-day summary', () => {
  const detailSql = spotifyPlaycountSql();
  assert.match(detailSql, /target\.artist_key='sakurazaka46'/);
  assert.doesNotMatch(detailSql, /nogizaka46|hinatazaka46/);

  const trendSql = spotifyTrendSql();
  assert.match(trendSql, /-89 days/);
  assert.match(trendSql, /FROM sh_spotify_artist_daily daily/);
  assert.match(trendSql, /daily\.total_delta/);
  assert.match(trendSql, /daily\.top10_delta/);
  assert.match(trendSql, /daily\.top10_year_delta/);
  assert.doesNotMatch(trendSql, /sh_spotify_playcount_daily|GROUP BY|SUM\(d\.delta\)/);
});

test('Spotify API publishes all three trend metrics', async () => {
  const response = await onRequestGet({
    env: {
      OTHER_DB: mockDb({
        latestRows: [row('sakurazaka46', 's1', 200, 10)],
        trendRows: [trendRow('sakurazaka46', '2026-09-27', 10, '櫻坂46', 16, 9, 4)],
      }),
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.trend.sakurazaka46[0].total_delta, 10);
  assert.equal(payload.trend.sakurazaka46[0].top10_delta, 9);
  assert.equal(payload.trend.sakurazaka46[0].top10_year_delta, 4);
});

test('Spotify public API variants resolve to one materialized R2 model and one cache key', () => {
  assert.equal(materializedApiKey(new URL('https://skrzk.test/api/spotify-playcounts')), 'spotify-playcounts');
  assert.equal(materializedApiKey(new URL('https://skrzk.test/api/spotify-playcounts?artist=nogizaka46')), 'spotify-playcounts');
  const plain = canonicalApiCacheRequest(new Request('https://skrzk.test/api/spotify-playcounts')).url;
  const legacy = canonicalApiCacheRequest(new Request('https://skrzk.test/api/spotify-playcounts?artist=hinatazaka46')).url;
  assert.equal(legacy, plain);
});

test('Spotify API reports missing D1 only on the producer path', async () => {
  const missing = await onRequestGet({ env: {} });
  assert.equal(missing.status, 503);
});

test('Spotify tab renders daily, top-10, and current-year top-10 graphs', () => {
  const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/spotify.css', import.meta.url), 'utf8');
  const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

  assert.match(shell, /Spotify 日次 - 再生数推移/);
  assert.match(shell, /Spotify 上位10曲 - 再生数推移/);
  assert.match(shell, /Spotify 上位10曲\(今年限定\) - 再生数推移/);
  assert.match(shell, /id="spotifyTrendCharts"/);
  assert.match(shell, /id="spotifyTop10TrendCharts"/);
  assert.match(shell, /id="spotifyTop10YearTrendCharts"/);

  assert.match(runtime, /metricKey: 'total_delta'/);
  assert.match(runtime, /metricKey: 'top10_delta'/);
  assert.match(runtime, /metricKey: 'top10_year_delta'/);
  assert.match(runtime, /spotify-trend-scroll chart-fit/);
  assert.match(runtime, /fetch\('\/api\/spotify-playcounts'\)/);

  assert.match(styles, /\.spotify-trend-legend/);
  assert.match(styles, /aspect-ratio: 960 \/ 340/);
  assert.match(sharedLayout, /\.chart-fit > :is\(svg, canvas\)[\s\S]*min-width:\s*0 !important/);
  assert.match(tabs, /import\('\/spotify\.js\?v=20260928\.5'\)/);
  assert.match(dashboard, /spotify-shell\.js\?v=20260928\.5/);
  assert.match(dashboard, /dashboard-tabs\.js\?v=20260928\.5/);
});
