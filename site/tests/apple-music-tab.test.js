import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet as appleMusicApi } from '../functions/api/apple-music.js';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/apple-music.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/apple-music.css', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/apple-music.js', import.meta.url), 'utf8');

test('Apple Music is a dashboard route backed only by the Worker materialized read model', () => {
  assert.match(tabs, /'apple-music':\s*\{/);
  assert.match(tabs, /import\('\/apple-music-shell\.js\?v=20260930\.1'\)/);
  assert.match(tabs, /import\('\/apple-music\.js\?v=20260930\.2'\)/);
  assert.match(tabs, /async function showLazyView/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /dashboardChartHost/);
  assert.match(sharedUi, /class="\$\{joinClasses\('shared-svg-chart', className\)\}"/);
  assert.match(runtime, /fetch\('\/api\/apple-music'/);
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response\?key=apple-music/);
  assert.doesNotMatch(api, /track-history-status/);
  assert.doesNotMatch(api, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.doesNotMatch(runtime, /\/api\/history|\/api\/dashboard|OTHER_DB|MINUTE_DB/);
});

test('Apple Music API treats an ungenerated read model as a non-cacheable empty successful dataset', async () => {
  const response = await appleMusicApi({
    env: {
      PAGES_READ_MODEL_SERVICE: {
        fetch: async () => new Response(null, { status: 404 }),
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.artist_name, '櫻坂46');
  assert.deepEqual(payload.regions, []);
  assert.deepEqual(payload.history, []);
});

test('Apple Music API preserves real materialized-service failures', async () => {
  const response = await appleMusicApi({
    env: {
      PAGES_READ_MODEL_SERVICE: {
        fetch: async () => new Response(null, { status: 500 }),
      },
    },
  });
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
  const service = {
    async fetch(request) {
      calls += 1;
      assert.equal(new URL(request.url).searchParams.get('key'), 'apple-music');
      return Response.json(applePayload, {
        headers: { 'x-materialized-at': '1234' },
      });
    },
  };

  const response = await appleMusicApi({ env: { PAGES_READ_MODEL_SERVICE: service } });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), applePayload);
  assert.equal(response.headers.get('x-materialized-at'), '1234');
});

test('Apple Music UI uses sh_tracks.id before localized song_key for identity', () => {
  assert.match(runtime, /const trackId = integer\(track\?\.track_id\)/);
  assert.match(runtime, /if \(trackId != null\) return `track:\$\{trackId\}`/);
  assert.match(runtime, /return String\(track\?\.song_key \|\| track\?\.apple_music_id \|\| ''\)/);
});

test('Apple Music view fixes the top graph to Japan and uses one regional ranking table', () => {
  assert.match(shell, /id: 'appleRankChart'/);
  assert.match(shell, /id="appleRankLegend"/);
  assert.match(shell, /日本の人気曲順位推移/);
  assert.match(shell, /id="appleRegionCompareTable"/);
  assert.match(shell, /地域別人気順位一覧/);
  assert.doesNotMatch(shell, /appleRegionTabs|appleMusicTbody|前日比/);
  assert.doesNotMatch(runtime, /selectedRegion|rankChangeLabel|renderCurrentTable|renderRegionTabs/);
  assert.match(runtime, /regionByCode\(payload, 'jp'\)/);
  assert.match(runtime, /point\?\.regions\?\.jp/);
});

test('Apple Music regional list is Japan-first and keeps other-region-only songs below it', () => {
  assert.match(runtime, /REGION_ORDER = Object\.freeze\(\['jp', 'tw', 'hk', 'kr', 'sg', 'th', 'us'\]\)/);
  assert.match(runtime, /row\.ranks\.get\('jp'\) != null/);
  assert.match(runtime, /row\.ranks\.get\('jp'\) == null/);
  assert.match(runtime, /aBest - bBest \|\| aAverage - bAverage/);
  assert.match(runtime, /rankHeader\.textContent = '順位'/);
  assert.match(runtime, /songHeader\.textContent = '曲名'/);
  assert.match(runtime, /cell\.textContent = rank == null \? '-' : String\(rank\)/);
});

test('Apple Music Japan rank chart keeps first place at the top and exposes a current-rank legend', () => {
  assert.match(runtime, /yFor = \(rank\) => margin\.top \+ \(rank - 1\)/);
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
