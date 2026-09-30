import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet as amazonMusicApi } from '../functions/api/amazon-music.js';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/amazon-music.css', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/amazon-music.js', import.meta.url), 'utf8');

test('Amazon Music is a dashboard route backed only by the Worker materialized read model', () => {
  assert.match(tabs, /'amazon-music':\s*\{/);
  assert.match(tabs, /import\('\/amazon-music-shell\.js\?v=20260929\.1'\)/);
  assert.match(tabs, /import\('\/amazon-music\.js\?v=20260929\.1'\)/);
  assert.match(tabs, /async function showLazyView/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /shared-svg-chart/);
  assert.match(runtime, /fetch\('\/api\/amazon-music'/);
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response\?key=amazon-music/);
  assert.doesNotMatch(api, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.doesNotMatch(runtime, /\/api\/history|\/api\/dashboard|OTHER_DB|MINUTE_DB/);
});

test('Amazon Music API treats an ungenerated read model as an uncached empty successful dataset', async () => {
  const response = await amazonMusicApi({
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
  assert.equal(payload.track_count, 0);
  assert.equal(payload.follower, null);
  assert.deepEqual(payload.tracks, []);
  assert.deepEqual(payload.history, []);
});

test('Amazon Music API preserves real materialized-service failures', async () => {
  const response = await amazonMusicApi({
    env: {
      PAGES_READ_MODEL_SERVICE: {
        fetch: async () => new Response(null, { status: 500 }),
      },
    },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

test('Amazon Music view is rank-only after retiring the daily follower collector', () => {
  assert.doesNotMatch(shell, /フォロワー数|前日比|amazonFollowerCount|amazonFollowerDelta/);
  assert.match(shell, /id="amazonAllRankChart"/);
  assert.doesNotMatch(shell, /amazonPopularRankChart|櫻坂内人気順|櫻坂46内 人気曲順位/);
  assert.match(shell, /Amazon総合順位/);
  assert.match(runtime, /metricKey: 'amazon_rank'/);
  assert.doesNotMatch(runtime, /popular_rank|amazonPopularRankChart/);
});

test('Amazon Music rank chart keeps first place at the top and fits mobile width', () => {
  assert.match(runtime, /yFor = \(rank\) => margin\.top \+ \(rank - 1\)/);
  assert.match(runtime, /ariaLabel: '櫻坂46全楽曲のAmazon Music総合順位推移。1位が上。'/);
  assert.match(shell, /amazon-rank-chart chart-fit shared-svg-chart/);
  assert.match(sharedCss, /\.shared-svg-chart svg[\s\S]*width:\s*100%/);
  assert.match(css, /\.amazon-table[\s\S]*table-layout:\s*fixed/);
});
