import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet as appleMusicApi } from '../functions/api/apple-music.js';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/apple-music.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/apple-music.css', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/apple-music.js', import.meta.url), 'utf8');

test('Apple Music is a dashboard route backed only by Worker materialized read models', () => {
  assert.match(tabs, /'apple-music':\s*\{/);
  assert.match(tabs, /import\('\/apple-music-shell\.js\?v=20260930\.1'\)/);
  assert.match(tabs, /import\('\/apple-music\.js\?v=20260930\.1'\)/);
  assert.match(tabs, /async function showLazyView/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /shared-svg-chart/);
  assert.match(runtime, /fetch\('\/api\/apple-music'/);
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response\?key=apple-music/);
  assert.match(api, /_internal\/pages-response\?key=track-history-status/);
  assert.doesNotMatch(api, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.doesNotMatch(runtime, /\/api\/history|\/api\/dashboard|OTHER_DB|MINUTE_DB/);
});

test('Apple Music API treats an ungenerated read model as an empty successful dataset', async () => {
  const response = await appleMusicApi({
    env: {
      PAGES_READ_MODEL_SERVICE: {
        fetch: async () => new Response(null, { status: 404 }),
      },
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /max-age=15/);
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

test('Apple Music API canonicalizes localized titles and identity with sh_tracks.id', async () => {
  const applePayload = {
    ok: true,
    regions: [
      { code: 'jp', tracks: [{ track_id: 101, rank: 1, title: 'ピッカーン！', song_key: 'ピッカーン！' }] },
      {
        code: 'us',
        tracks: [
          { track_id: 101, rank: 2, title: 'Pikkaan!', song_key: 'pikkaan!' },
          { track_id: 202, rank: 3, title: 'Samidareyo', song_key: 'samidareyo' },
          { track_id: null, rank: 4, title: 'Unresolved Song', song_key: 'unresolvedsong' },
        ],
      },
    ],
    history: [{
      snapshot_date: '2026-09-29',
      regions: {
        us: [
          { track_id: 101, rank: 3, song_key: 'pikkaan!' },
          { track_id: null, rank: 4, song_key: 'unresolvedsong' },
        ],
      },
    }],
  };
  const titlePayload = {
    ranking: [
      { track_id: 101, title: 'ピッカーン！' },
      { track_id: 202, title: '五月雨よ' },
    ],
  };
  const service = {
    async fetch(request) {
      const url = new URL(request.url);
      const key = url.searchParams.get('key');
      if (key === 'apple-music') return Response.json(applePayload);
      if (key === 'track-history-status') return Response.json(titlePayload);
      return new Response(null, { status: 404 });
    },
  };

  const response = await appleMusicApi({ env: { PAGES_READ_MODEL_SERVICE: service } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const us = payload.regions.find((region) => region.code === 'us');
  assert.deepEqual(us.tracks.map(({ track_id: trackId, title, song_key: songKey }) => ({ trackId, title, songKey })), [
    { trackId: 101, title: 'ピッカーン！', songKey: 'track:101' },
    { trackId: 202, title: '五月雨よ', songKey: 'track:202' },
    { trackId: null, title: 'Unresolved Song', songKey: 'unresolvedsong' },
  ]);
  assert.equal(payload.regions[0].tracks[0].song_key, 'track:101');
  assert.equal(payload.history[0].regions.us[0].song_key, 'track:101');
  assert.equal(payload.history[0].regions.us[1].song_key, 'unresolvedsong');
});

test('Apple Music view fixes the top graph to Japan and uses one regional ranking table', () => {
  assert.match(shell, /id="appleRankChart"/);
  assert.match(shell, /id="appleRankLegend"/);
  assert.match(shell, /日本 人気曲順位推移/);
  assert.match(shell, /id="appleRegionCompareTable"/);
  assert.match(shell, /地域別 人気順位一覧/);
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
  assert.match(runtime, /日本のApple Music櫻坂46人気曲順位推移。1位が上。/);
  assert.match(runtime, /renderJapanLegend/);
  assert.match(shell, /apple-rank-chart chart-fit shared-svg-chart/);
  assert.match(sharedCss, /\.shared-svg-chart svg[\s\S]*width:\s*100%/);
  assert.match(css, /\.apple-rank-legend[\s\S]*grid-template-columns/);
  assert.match(css, /\.apple-region-table[\s\S]*min-width:\s*820px/);
  assert.match(css, /\.apple-region-table-wrap[\s\S]*overflow-x:\s*auto/);
});
