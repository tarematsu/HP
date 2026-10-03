import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet as amazonMusicApi } from '../functions/api/amazon-music.js';
import { onRequestGet as amazonPlaylistApi } from '../functions/api/amazon-music-playlists.js';

const shell = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');
const commonShell = readFileSync(new URL('../public/music-service-shell.js', import.meta.url), 'utf8');
const musicCss = readFileSync(new URL('../public/music-service-common.css', import.meta.url), 'utf8');
const rankChart = readFileSync(new URL('../public/dashboard-rank-chart.js', import.meta.url), 'utf8');
const workerCollector = readFileSync(new URL('../../worker/src/amazon-music-collector.js', import.meta.url), 'utf8');

function materializedService(payload, { status = 200 } = {}) {
  return {
    fetch: async () => new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }),
  };
}

test('Amazon Music API returns an empty successful read model when materialization has not run yet', async () => {
  const response = await amazonMusicApi({ env: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    source: 'amazon_music_rankings',
    observed_at: null,
    snapshot_date: null,
    tracks: [],
    history: [],
  });
});

test('Amazon Music API serves the materialized worker payload', async () => {
  const payload = {
    ok: true,
    source: 'amazon_music_rankings',
    observed_at: 1_790_000_000_000,
    snapshot_date: '2026-09-25',
    tracks: [{ track_id: 13, title: '承認欲求', group_name: '櫻坂46', amazon_rank: 22 }],
    history: [{ snapshot_date: '2026-09-24', tracks: [{ track_id: 13, amazon_rank: 28 }] }],
  };
  const response = await amazonMusicApi({ env: { PAGES_READ_MODEL_SERVICE: materializedService(payload) } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), payload);
});

test('Amazon Music playlist API treats an ungenerated read model as an empty successful dataset', async () => {
  const response = await amazonPlaylistApi({ env: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, provider: 'amazon', generated_at: null, tracks: [], playlists: [] });
});

test('Amazon Music API preserves real materialized-service failures', async () => {
  const response = await amazonMusicApi({
    env: { PAGES_READ_MODEL_SERVICE: { fetch: async () => new Response(null, { status: 500 }) } },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

test('Amazon Music uses the QQ metadata and section layout while keeping Sakamichi switches', () => {
  assert.match(shell, /musicServiceMeta\(\{ valueId: 'amazonUpdatedAt', cadence: '毎日6:00' \}\)/);
  assert.match(shell, /className: musicServiceViewClassName\('amazon-music-view'\)/);
  assert.match(shell, /musicServiceSection/);
  assert.match(shell, /dashboardModeTabs/);
  assert.match(commonShell, /'regional-music-view', 'is-chart-compact', 'music-service-view'/);
  assert.match(commonShell, /'regional-chart-meta', 'music-service-meta'/);
  assert.match(commonShell, /'music-service-section', 'regional-chart-section'/);
  assert.match(shell, /title: 'Amazon Music総合順位推移'/);
  assert.match(shell, /title: '全楽曲順位'/);
  assert.match(shell, /title: 'Amazon Music プレイリスト掲載一覧'/);
  for (const mode of ['all', 'titles', 'sakurazaka', 'nogizaka', 'hinatazaka']) {
    assert.match(shell, new RegExp(`value: '${mode}'`));
  }
  assert.match(shell, /全楽曲順位/);
  assert.match(shell, /表題曲比較/);
  assert.match(shell, /櫻坂46/);
  assert.match(shell, /乃木坂46/);
  assert.match(shell, /日向坂46/);
  assert.match(shell, /headers: \['Amazon Music総合順位', '前日比', 'アーティスト', '曲名'\]/);
  assert.match(musicCss, /\.music-service-section/);
  assert.doesNotMatch(shell, /dashboardSummary|dashboardSummaryItem|dashboardDataCard|dashboardChartCard/);
});

test('Amazon Music title comparison and artist modes use Worker title-track flags', () => {
  assert.match(runtime, /isTitleTrack = \(track\) => track\?\.is_title_track === true/);
  assert.match(runtime, /mode === 'titles'/);
  assert.match(runtime, /track\?\.group_name === group && isTitleTrack\(track\)/);
  assert.match(runtime, /tableTitle: `\$\{group\} 全楽曲順位`/);
  assert.match(runtime, /chartTitle: `\$\{group\} 表題曲 Amazon Music総合順位推移`/);
});

test('Amazon Music rank chart keeps first place at the top and fits mobile width', () => {
  assert.match(runtime, /renderRankHistoryChart\(/);
  assert.match(rankChart, /const boundedRank = Math\.min\(ceiling, Math\.max\(1, Number\(rank\)\)\)/);
  assert.match(rankChart, /const y = margin\.top \+ \(boundedRank - 1\) \/ denominator \* plotHeight/);
  assert.match(runtime, /containerId: 'amazonAllRankChart'/);
  assert.match(shell, /className: 'amazon-rank-chart chart-fit'/);
});

test('Amazon collector scopes ranking materialization to the three Sakamichi groups', () => {
  assert.match(workerCollector, /AMAZON_MUSIC_GROUPS/);
  for (const group of ['乃木坂46', '櫻坂46', '日向坂46']) assert.match(workerCollector, new RegExp(group));
});
