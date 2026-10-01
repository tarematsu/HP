import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet as amazonMusicApi } from '../functions/api/amazon-music.js';
import { onRequestGet as amazonMusicPlaylistsApi } from '../functions/api/amazon-music-playlists.js';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');
const rankChart = readFileSync(new URL('../public/dashboard-rank-chart.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/amazon-music.css', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const musicCss = readFileSync(new URL('../public/music-service-common.css', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/amazon-music.js', import.meta.url), 'utf8');
const playlistApi = readFileSync(new URL('../functions/api/amazon-music-playlists.js', import.meta.url), 'utf8');

test('Amazon Music is a dashboard route backed only by Worker materialized read models', () => {
  assert.match(tabs, /'amazon-music':\s*\{/);
  assert.match(tabs, /import\('\/amazon-music-shell\.js\?v=20261001\.2'\)/);
  assert.match(tabs, /import\('\/amazon-music\.js\?v=20261001\.2'\)/);
  assert.match(tabs, /async function showLazyView/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /dashboardChartHost/);
  assert.match(sharedUi, /class="\$\{joinClasses\('shared-svg-chart', className\)\}"/);
  assert.match(runtime, /fetch\('\/api\/amazon-music'/);
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response\?key=amazon-music/);
  assert.match(playlistApi, /_internal\/pages-response\?key=amazon-music-playlists/);
  assert.doesNotMatch(api, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.doesNotMatch(playlistApi, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.doesNotMatch(runtime, /\/api\/history|\/api\/dashboard|OTHER_DB|MINUTE_DB/);
});

test('Amazon Music API treats an ungenerated read model as an uncached empty successful dataset', async () => {
  const response = await amazonMusicApi({
    env: { PAGES_READ_MODEL_SERVICE: { fetch: async () => new Response(null, { status: 404 }) } },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.version, 3);
  assert.equal(payload.artist_name, '坂道3グループ');
  assert.deepEqual(payload.artists, ['乃木坂46', '櫻坂46', '日向坂46']);
  assert.equal(payload.track_count, 0);
  assert.deepEqual(payload.tracks, []);
  assert.deepEqual(payload.history, []);
});

test('Amazon Music playlist API treats an ungenerated read model as an empty successful dataset', async () => {
  const response = await amazonMusicPlaylistsApi({
    env: { PAGES_READ_MODEL_SERVICE: { fetch: async () => new Response(null, { status: 404 }) } },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.tracks, []);
});

test('Amazon Music API preserves real materialized-service failures', async () => {
  const response = await amazonMusicApi({
    env: { PAGES_READ_MODEL_SERVICE: { fetch: async () => new Response(null, { status: 500 }) } },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

test('Amazon Music view keeps metadata first and exposes Sakamichi switches', () => {
  assert.match(shell, /musicServiceMeta\(\{ valueId: 'amazonSnapshotDate' \}\)/);
  assert.match(shell, /className: 'amazon-music-view music-service-view'/);
  assert.match(shell, /title: '推移'/);
  assert.match(shell, /title: '楽曲'/);
  assert.match(shell, /title: 'プレイリスト'/);
  for (const mode of ['all', 'titles', 'nogizaka', 'sakurazaka', 'hinatazaka']) {
    assert.match(shell, new RegExp(`data-amazon-mode="${mode}"`));
  }
  assert.match(shell, /全楽曲順位/);
  assert.match(shell, /表題曲比較/);
  assert.match(shell, /乃木坂46/);
  assert.match(shell, /櫻坂46/);
  assert.match(shell, /日向坂46/);
  assert.match(shell, /headers: \['Amazon Music総合順位', '前日比', 'アーティスト', '曲名'\]/);
  assert.match(musicCss, /\.music-service-summary\.summary-cards/);
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
  assert.match(rankChart, /const yFor = \(rank\) => margin\.top \+ \(rank - 1\)/);
  assert.match(runtime, /坂道3グループ全楽曲のAmazon Music総合順位推移。1位が上。/);
  assert.match(shell, /className: 'amazon-rank-chart chart-fit'/);
  assert.match(sharedUi, /joinClasses\('shared-svg-chart', className\)/);
  assert.match(sharedCss, /\.shared-svg-chart svg[\s\S]*width:\s*100%/);
  assert.match(css, /\.amazon-table[\s\S]*table-layout:\s*fixed/);
  assert.match(css, /\.amazon-mode-switch\.mode-tabs[\s\S]*overflow-x:\s*auto/);
});
