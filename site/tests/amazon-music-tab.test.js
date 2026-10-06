import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ROUTES } from '../public/dashboard-navigation-config.js';

import { onRequestGet as amazonMusicApi } from '../functions/api/amazon-music.js';
import { onRequestGet as amazonMusicPlaylistsApi } from '../functions/api/amazon-music-playlists.js';

const shell = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');
const rankChart = readFileSync(new URL('../public/dashboard-rank-chart.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/amazon-music.css', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const musicCss = readFileSync(new URL('../public/music-service-common.css', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const commonShell = readFileSync(new URL('../public/music-service-shell.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/amazon-music.js', import.meta.url), 'utf8');
const playlistApi = readFileSync(new URL('../functions/api/amazon-music-playlists.js', import.meta.url), 'utf8');

test('Amazon Music is a dashboard route backed only by Worker materialized read models', () => {
  const route = ROUTES['amazon-music'];
  assert.equal(route.kind, 'lazy');
  assert.equal(route.viewId, 'amazonMusicView');
  assert.equal(route.moduleId, 'amazon-music');
  assert.equal(route.loadExport, 'loadAmazonMusicView');
  assert.match(shell, /mountMusicServiceView/);
  assert.match(commonShell, /mountDashboardShell/);
  assert.match(shell, /dashboardChartHost/);
  assert.match(sharedUi, /class="\$\{joinClasses\('shared-svg-chart', className\)\}"/);
  assert.match(runtime, /loadDashboardJson\('\/api\/amazon-music'/);
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

test('Amazon Music uses the shared music-service metadata and section layout while keeping Sakamichi switches', () => {
  assert.match(shell, /meta: \{ valueId: 'amazonUpdatedAt', cadence: '毎日6:00' \}/);
  assert.match(shell, /className: 'amazon-music-view'/);
  assert.match(shell, /musicServiceSection/);
  assert.match(shell, /musicServiceFilterTabs/);
  assert.match(shell, /musicServiceTable/);
  assert.match(commonShell, /joinClasses\('is-chart-compact', 'music-service-view', classes\)/);
  assert.match(commonShell, /'music-service-meta'/);
  assert.match(commonShell, /'music-service-section'/);
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
  assert.match(rankChart, /return margin\.top \+ \(boundedRank - 1\)/);
  assert.match(runtime, /坂道3グループ全楽曲のAmazon Music総合順位推移。1位が上。/);
  assert.match(shell, /className: 'amazon-rank-chart chart-fit'/);
  assert.match(sharedUi, /joinClasses\('shared-svg-chart', className\)/);
  assert.match(sharedCss, /\.shared-svg-chart svg[\s\S]*width:\s*100%/);
  assert.match(css, /\.amazon-table[\s\S]*table-layout:\s*fixed/);
  assert.match(musicCss, /\.music-service-filter\.mode-tabs[\s\S]*overflow-x:\s*auto/);
});
