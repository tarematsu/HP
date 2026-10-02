import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet as appleMusicApi } from '../functions/api/apple-music.js';
import { onRequestGet as appleMusicPlaylistsApi } from '../functions/api/apple-music-playlists.js';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/apple-music.js', import.meta.url), 'utf8');
const playlistRuntime = readFileSync(new URL('../public/apple-music-playlists.js', import.meta.url), 'utf8');
const rankChart = readFileSync(new URL('../public/dashboard-rank-chart.js', import.meta.url), 'utf8');
const tableDom = readFileSync(new URL('../public/dashboard-table-dom.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/apple-music.css', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/apple-music.js', import.meta.url), 'utf8');
const playlistApi = readFileSync(new URL('../functions/api/apple-music-playlists.js', import.meta.url), 'utf8');

test('Apple Music is a dashboard route backed only by Worker materialized read models', () => {
  assert.match(tabs, /'apple-music':\s*\{/);
  assert.match(tabs, /import\('\/apple-music-shell\.js\?v=20261001\.1'\)/);
  assert.match(tabs, /import\(location\.origin \+ '\/apple-music\.js\?v=20261001\.1'\)/);
  assert.doesNotMatch(tabs, /runtime:\s*\(\) => import\('\/apple-music\.js/);
  assert.match(tabs, /async function showLazyView/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /dashboardChartHost/);
  assert.match(sharedUi, /class="\$\{joinClasses\('shared-svg-chart', className\)\}"/);
  assert.match(runtime, /fetch\('\/api\/apple-music'/);
  assert.match(runtime, /import\(playlistModuleUrl\(\)\)/);
  assert.match(playlistRuntime, /fetch\('\/api\/apple-music-playlists'/);
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response\?key=apple-music/);
  assert.match(playlistApi, /PAGES_READ_MODEL_SERVICE/);
  assert.match(playlistApi, /_internal\/pages-response\?key=apple-music-playlists/);
  assert.doesNotMatch(api, /track-history-status/);
  assert.doesNotMatch(api, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.doesNotMatch(playlistApi, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.doesNotMatch(runtime, /\/api\/history|\/api\/dashboard|OTHER_DB|MINUTE_DB/);
  assert.doesNotMatch(playlistRuntime, /OTHER_DB|MINUTE_DB/);
});

test('Apple Music playlist UI stays outside the shared dashboard bundle', () => {
  assert.match(runtime, /function playlistModuleUrl\(\)/);
  assert.match(runtime, /\['\/apple-music-playlists\.js', 'v=20261001\.1'\]\.join\('\?'\)/);
  assert.match(runtime, /import\(playlistModuleUrl\(\)\)/);
  assert.doesNotMatch(runtime, /import\(['"]\/apple-music-playlists\.js/);
  assert.doesNotMatch(shell, /applePlaylistTable|PUBLIC PLAYLISTS/);
});

test('Apple Music API treats an ungenerated read model as a non-cacheable empty successful dataset', async () => {
  const response = await appleMusicApi({ env: { PAGES_READ_MODEL_SERVICE: { fetch: async () => new Response(null, { status: 404 }) } } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.artist_name, '櫻坂46');
  assert.deepEqual(payload.regions, []);
  assert.deepEqual(payload.history, []);
});

test('Apple Music playlist API treats an ungenerated read model as an empty successful dataset', async () => {
  const response = await appleMusicPlaylistsApi({ env: { PAGES_READ_MODEL_SERVICE: { fetch: async () => new Response(null, { status: 404 }) } } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.artist_name, '櫻坂46');
  assert.equal(payload.coverage.matched_playlists, 0);
  assert.deepEqual(payload.playlists, []);
  assert.deepEqual(payload.tracks, []);
});

test('Apple Music API preserves real materialized-service failures', async () => {
  const response = await appleMusicApi({ env: { PAGES_READ_MODEL_SERVICE: { fetch: async () => new Response(null, { status: 500 }) } } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

test('Apple Music API streams the materialized payload without request-time cross-model joins', async () => {
  const applePayload = {
    ok: true,
    regions: [
      { code: 'jp', tracks: [{ track_id: 101, rank: 1, title: 'ピッカーン！', song_key: 'ピッカーン！' }] },
      { code: 'us', tracks: [{ track_id: 101, rank: 2, title: 'Pikkaan!', song_key: 'pikkaan!' }] },
    ],
    history: [],
  };
  let calls = 0;
  const service = { async fetch(request) {
    calls += 1;
    assert.equal(new URL(request.url).searchParams.get('key'), 'apple-music');
    return Response.json(applePayload, { headers: { 'x-materialized-at': '1234' } });
  } };
  const response = await appleMusicApi({ env: { PAGES_READ_MODEL_SERVICE: service } });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), applePayload);
  assert.equal(response.headers.get('x-materialized-at'), '1234');
});

test('Apple Music playlist API streams the independently materialized playlist payload', async () => {
  const payload = {
    ok: true,
    source: 'music.apple.com-public-pages',
    tracks: [{ track_id: 101, title: 'UDAGAWA GENERATION', playlists: [{ id: 'pl.test', name: 'Test' }] }],
    playlists: [{ id: 'pl.test', name: 'Test' }],
  };
  let calls = 0;
  const service = { async fetch(request) {
    calls += 1;
    assert.equal(new URL(request.url).searchParams.get('key'), 'apple-music-playlists');
    return Response.json(payload, { headers: { 'x-materialized-at': '5678' } });
  } };
  const response = await appleMusicPlaylistsApi({ env: { PAGES_READ_MODEL_SERVICE: service } });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), payload);
  assert.equal(response.headers.get('x-materialized-at'), '5678');
});

test('Apple Music UI uses sh_tracks.id before localized song_key for identity', () => {
  assert.match(runtime, /const trackId = integer\(track\?\.track_id\)/);
  assert.match(runtime, /if \(trackId != null\) return `track:\$\{trackId\}`/);
  assert.match(runtime, /return String\(track\?\.song_key \|\| track\?\.apple_music_id \|\| ''\)/);
});

test('Apple Music view fixes the top graph to Japan and uses one regional ranking table', () => {
  assert.match(shell, /id: 'appleRankChart'/);
  assert.match(shell, /dashboardLegend/);
  assert.match(shell, /id: 'appleRankLegend'/);
  assert.match(shell, /日本の人気曲順位推移/);
  assert.match(shell, /dashboardTable/);
  assert.match(shell, /id: 'appleRegionCompareTable'/);
  assert.match(shell, /地域別人気順位一覧/);
  assert.doesNotMatch(shell, /appleRegionTabs|appleMusicTbody|前日比/);
  assert.doesNotMatch(runtime, /selectedRegion|rankChangeLabel|renderCurrentTable|renderRegionTabs/);
  assert.match(runtime, /regionByCode\(payload, 'jp'\)/);
  assert.match(runtime, /point\?\.regions\?\.jp/);
});

test('Apple Music lazy playlist view lists public-site playlist memberships by song', () => {
  assert.match(playlistRuntime, /dashboardDataCard/);
  assert.match(playlistRuntime, /dashboardTable/);
  assert.match(playlistRuntime, /id: 'applePlaylistTable'/);
  assert.match(playlistRuntime, /楽曲別プレイリスト掲載一覧/);
  assert.match(playlistRuntime, /Apple Music公式サイト上で検出できた公開プレイリスト/);
  assert.match(playlistRuntime, /safeAppleMusicUrl/);
  assert.match(playlistRuntime, /membership\?\.position/);
  assert.match(playlistRuntime, /loadAppleMusicPlaylistMemberships/);
});

test('Apple Music regional list is Japan-first and keeps other-region-only songs below it', () => {
  assert.match(runtime, /REGION_ORDER = Object\.freeze\(\['jp', 'tw', 'hk', 'kr', 'sg', 'th', 'us'\]\)/);
  assert.match(runtime, /row\.ranks\.get\('jp'\) != null/);
  assert.match(runtime, /row\.ranks\.get\('jp'\) == null/);
  assert.match(runtime, /aBest - bBest \|\| aAverage - bAverage/);
  assert.match(runtime, /replaceTableHeader\(thead, \['順位', '曲名'/);
  assert.match(runtime, /appendTableRow\(tbody, \[/);
  assert.match(runtime, /text: item\.ranks\.get\(region\.code\) \?\? '-'/);
  assert.match(runtime, /className: 'apple-rank-number'/);
  assert.match(tableDom, /export function replaceTableHeader\(/);
});

test('Apple Music Japan rank chart keeps first place at the top and exposes a current-rank legend', () => {
  assert.match(runtime, /renderRankHistoryChart\(/);
  assert.match(rankChart, /const boundedRank = Math\.min\(ceiling, Math\.max\(1, Number\(rank\)\)\)/);
  assert.match(rankChart, /return margin\.top \+ \(boundedRank - 1\)/);
  assert.match(runtime, /人気曲順位。1位が上、圏外が下。/);
  assert.match(runtime, /renderJapanLegend/);
  assert.match(shell, /className: 'apple-rank-chart chart-fit'/);
  assert.match(sharedUi, /joinClasses\('shared-svg-chart', className\)/);
  assert.match(sharedCss, /\.shared-svg-chart svg[\s\S]*width:\s*100%/);
  assert.match(css, /\.apple-rank-legend[\s\S]*grid-template-columns/);
  assert.match(css, /\.apple-region-table[\s\S]*min-width:\s*820px/);
  assert.match(css, /\.apple-region-table-wrap[\s\S]*overflow-x:\s*auto/);
});

test('Apple Music Japan rank chart keeps former top-12 songs on an outside lane', () => {
  assert.match(runtime, /const JAPAN_RANK_LIMIT = 12;/);
  assert.match(runtime, /const JAPAN_OUTSIDE_RANK = JAPAN_RANK_LIMIT \+ 1;/);
  assert.match(runtime, /item\.points\.push\(\{ date, rank: ranks\.get\(item\.id\) \?\? JAPAN_OUTSIDE_RANK \}\)/);
  assert.match(runtime, /item\.points\.push\(\{ date, rank: null \}\)/);
  assert.match(runtime, /title: track\?\.title \|\| track\?\.song_key \|\| '曲名不明'/);
  assert.match(runtime, /if \(rank === JAPAN_OUTSIDE_RANK\) return '圏外';/);
  assert.match(runtime, /JAPAN_RANK_LIMIT, JAPAN_OUTSIDE_RANK/);
});
