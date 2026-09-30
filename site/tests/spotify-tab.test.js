import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  onRequestGet,
  spotifyArtist,
  spotifyArtistChartSql,
  spotifyPlaycountSql,
  spotifyReadModel,
  spotifyTrendSql,
  SPOTIFY_TREND_START_DATE,
} from '../functions/api/spotify-playcounts.js';
import {
  canonicalApiCacheRequest,
  materializedApiKey,
} from '../functions/lib/api-contract.js';

function mockDb({ latestRows = [], trendRows = [], artistChartRows = [] }) {
  return {
    prepare(sql) {
      const rows = sql === spotifyPlaycountSql()
        ? latestRows
        : sql === spotifyTrendSql()
          ? trendRows
          : sql === spotifyArtistChartSql()
            ? artistChartRows
            : null;
      assert.notEqual(rows, null, `unexpected SQL: ${sql}`);
      return { async all() { return { results: rows }; } };
    },
  };
}

function row(artistKey, trackId, playcount, delta, snapshotDate = '2026-09-27', spotifyTrackId = null) {
  return {
    artist_key: artistKey,
    snapshot_date: snapshotDate,
    track_id: trackId,
    spotify_track_id: spotifyTrackId || `spotify-${trackId}`,
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

function chartRow(artistKey, artistName, chartDate, rank) {
  return {
    chart_date: chartDate,
    artist_key: artistKey,
    artist_name: artistName,
    rank,
    previous_rank: rank + 1,
    peak_rank: Math.max(1, rank - 4),
    streak: 7,
    observed_at: Date.parse(`${chartDate}T22:20:00Z`),
  };
}

test('Spotify detail artist is fixed to Sakurazaka', () => {
  assert.deepEqual(spotifyArtist(), { key: 'sakurazaka46', name: '櫻坂46' });
  assert.deepEqual(spotifyArtist('sakurazaka46'), { key: 'sakurazaka46', name: '櫻坂46' });
  assert.equal(spotifyArtist('nogizaka46'), null);
  assert.equal(spotifyArtist('hinatazaka46'), null);
  assert.equal(spotifyArtist('unknown'), null);
});

test('Spotify read model keeps playcount metrics and normalized Japan artist ranks together', () => {
  const model = spotifyReadModel([
    row('nogizaka46', 11, 1000, 100),
    row('sakurazaka46', 12, 1200, 120),
    row('hinatazaka46', 13, 800, 80),
  ], [
    trendRow('equal-love', '2026-09-26', 210, '＝LOVE', 1, 180, 70),
    trendRow('equal-love', '2026-09-27', 220, '＝LOVE', 1, 190, 80),
    trendRow('sakurazaka46', '2026-09-27', 120, '櫻坂46', 16, 110, 50),
  ], [
    chartRow('equal-love', '＝LOVE', '2026-09-26', 8),
    chartRow('sakurazaka46', '櫻坂46', '2026-09-26', 18),
    chartRow('equal-love', '＝LOVE', '2026-09-27', 7),
    chartRow('sakurazaka46', '櫻坂46', '2026-09-27', 16),
  ]);

  assert.deepEqual(Object.keys(model.groups), ['sakurazaka46']);
  assert.equal(model.groups.sakurazaka46.track_count, 1);
  assert.equal(model.groups.sakurazaka46.total_delta, 120);
  assert.equal(model.groups.sakurazaka46.tracks[0].track_id, 12);
  assert.equal(model.groups.sakurazaka46.unresolved_track_count, 0);
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
  assert.equal(model.artist_chart.chart_id, 'artist-jp-daily');
  assert.equal(model.artist_chart.latest_chart_date, '2026-09-27');
  assert.deepEqual(
    model.artist_chart.days.map((day) => [
      day.chart_date,
      day.entries.map((entry) => [entry.artist_key, entry.rank]),
    ]),
    [
      ['2026-09-26', [['equal-love', 8], ['sakurazaka46', 18]]],
      ['2026-09-27', [['equal-love', 7], ['sakurazaka46', 16]]],
    ],
  );
});

test('Spotify detail merges source editions by sh_tracks.id and sorts by delta', () => {
  const first = row('sakurazaka46', 21, 9_386_149, 3_991, '2026-09-27', 'single-id');
  first.name = '自業自得';
  const second = row('sakurazaka46', 21, 9_386_149, 3_991, '2026-09-27', 'album-id');
  second.name = ' 自業自得　';
  const third = row('sakurazaka46', 22, 8_781_230, 3_847, '2026-09-27', 'other-id');
  third.name = '承認欲求';
  const payload = spotifyReadModel([third, second, first], [], []).groups.sakurazaka46;

  assert.equal(payload.track_count, 2);
  assert.deepEqual(payload.tracks.map((track) => track.track_id), [21, 22]);
  assert.deepEqual(payload.tracks.map((track) => track.name), ['自業自得', '承認欲求']);
  assert.equal(payload.total_delta, 3_991 + 3_847);
  assert.deepEqual(payload.tracks.map((track) => track.rank), [1, 2]);
});

test('Spotify read-model SQL resolves source ids through the shared sh_tracks.id reference', () => {
  assert.equal(SPOTIFY_TREND_START_DATE, '2026-09-28');

  const detailSql = spotifyPlaycountSql();
  assert.match(detailSql, /target\.artist_key='sakurazaka46'/);
  assert.match(detailSql, /LEFT JOIN music_service_track_refs ref/);
  assert.match(detailSql, /ref\.service='spotify'/);
  assert.match(detailSql, /ref\.source_track_id=d\.track_id/);
  assert.match(detailSql, /d\.track_id AS spotify_track_id/);
  assert.doesNotMatch(detailSql, /nogizaka46|hinatazaka46/);

  const trendSql = spotifyTrendSql();
  assert.match(trendSql, /FROM sh_spotify_artist_daily daily/);
  assert.match(trendSql, /daily\.snapshot_date >= '2026-09-28'/);
  assert.match(trendSql, /daily\.total_delta/);
  assert.match(trendSql, /daily\.top10_delta/);
  assert.match(trendSql, /daily\.top10_year_delta/);
  assert.doesNotMatch(trendSql, /-89 days|sh_spotify_playcount_daily|SUM\(d\.delta\)/);

  const chartSql = spotifyArtistChartSql();
  assert.match(chartSql, /FROM sh_spotify_artist_chart_daily chart/);
  assert.match(chartSql, /chart\.chart_date >= '2026-09-28'/);
  assert.doesNotMatch(chartSql, /-89 days|spotify\/charts|homepanel-cloud/);
});

test('Spotify API publishes trend metrics and Japan daily artist ranks in one model', async () => {
  const response = await onRequestGet({
    env: {
      OTHER_DB: mockDb({
        latestRows: [row('sakurazaka46', 31, 200, 10, '2026-09-27', 's1')],
        trendRows: [trendRow('sakurazaka46', '2026-09-27', 10, '櫻坂46', 16, 9, 4)],
        artistChartRows: [chartRow('sakurazaka46', '櫻坂46', '2026-09-27', 16)],
      }),
    },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.groups.sakurazaka46.tracks[0].track_id, 31);
  assert.equal(payload.groups.sakurazaka46.tracks[0].spotify_track_id, 's1');
  assert.equal(payload.trend.sakurazaka46[0].total_delta, 10);
  assert.equal(payload.trend.sakurazaka46[0].top10_delta, 9);
  assert.equal(payload.trend.sakurazaka46[0].top10_year_delta, 4);
  assert.equal(payload.artist_chart.days[0].entries[0].rank, 16);
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

test('Spotify tab uses only the materialized Spotify read model for its three graphs', () => {
  const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/spotify.css', import.meta.url), 'utf8');
  const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

  assert.match(shell, /Spotify 全曲合計の再生数前日比推移（上位10組）/);
  assert.match(shell, /Spotify 今年リリース上位10曲合計の再生数前日比推移（上位10組）/);
  assert.doesNotMatch(shell, /最新前日比 上位10アーティスト/);
  assert.match(shell, /Spotify Daily Top Artist（日本）の順位推移/);
  assert.doesNotMatch(shell, /Spotify デイリートップアーティスト\(日本\) 順位推移/);
  assert.match(shell, /集計日/);
  assert.match(shell, /櫻坂46の楽曲数/);
  assert.match(shell, /櫻坂46の再生数前日比合計/);
  assert.match(shell, /headers: \['順位', '曲名', '累計再生数', '前日比'\]/);
  assert.match(shell, /最新日の全曲合計再生数前日比が大きい女性アイドル上位10組の推移/);
  assert.doesNotMatch(shell, / - 再生数推移/);
  assert.match(shell, /id="spotifyTrendCharts"/);
  assert.doesNotMatch(shell, /id="spotifyTop10TrendCharts"/);
  assert.match(shell, /id="spotifyTop10YearTrendCharts"/);
  assert.match(shell, /id="spotifyArtistRankTrendCharts"/);

  assert.match(runtime, /const TREND_ARTIST_LIMIT = 10/);
  assert.match(runtime, /metricKey: 'total_delta'/);
  assert.doesNotMatch(runtime, /spotifyTop10TrendCharts|metricKey: 'top10_delta'/);
  assert.match(runtime, /metricKey: 'top10_year_delta'/);
  assert.match(runtime, /normalizeTrendSeries\(trend\)/);
  assert.match(runtime, /selectTrendSeriesByLatestMetric\(normalizedSeries, metricKey, maxSeries\)/);
  assert.doesNotMatch(runtime, /normalizedSeries\.slice\(0, maxSeries\)/);
  assert.equal((runtime.match(/maxSeries: TREND_ARTIST_LIMIT/g) || []).length, 2);
  assert.match(runtime, /renderArtistRankChart/);
  assert.match(runtime, /model\?\.artist_chart/);
  assert.match(runtime, /latestValue\.textContent = latest \? `\$\{numberFormat\.format\(latest\.rank\)\}位` : '-'/);
  assert.match(runtime, /spotify-trend-scroll chart-fit/);
  assert.match(runtime, /fetch\('\/api\/spotify-playcounts'\)/);
  assert.doesNotMatch(runtime, /homepanel-cloud|SPOTIFY_ARTIST_CHART_URL|fetchArtistChart/);

  assert.match(styles, /\.spotify-trend-legend/);
  assert.match(styles, /aspect-ratio: 960 \/ 340/);
  assert.match(sharedLayout, /\.chart-fit > :is\(svg, canvas\)[\s\S]*min-width:\s*0 !important/);
  assert.match(tabs, /import\('\/spotify-shell\.js\?v=20260929\.1'\)/);
  assert.match(tabs, /import\('\/spotify\.js\?v=20260929\.1'\)/);
  assert.match(dashboard, /dashboard-tabs\.js\?v=20260930\.1/);
  assert.doesNotMatch(dashboard, /^import .*spotify-shell/m);
});
