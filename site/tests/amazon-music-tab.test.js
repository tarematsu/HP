import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet as amazonMusicApi } from '../functions/api/amazon-music.js';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/amazon-music.js', import.meta.url), 'utf8');
const titleTracks = readFileSync(new URL('../public/amazon-music-title-tracks.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/amazon-music.css', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/amazon-music.js', import.meta.url), 'utf8');

test('Amazon Music is a dashboard route backed only by the Worker materialized read model', () => {
  assert.match(tabs, /'amazon-music':\s*\{/);
  assert.match(tabs, /import\('\/amazon-music-shell\.js\?v=20260929\.1'\)/);
  assert.match(tabs, /import\('\/amazon-music\.js\?v=20260929\.1'\)/);
  assert.match(tabs, /async function showLazyView/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /dashboardChartHost/);
  assert.match(sharedUi, /class="\$\{joinClasses\('shared-svg-chart', className\)\}"/);
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

test('Amazon Music view keeps snapshot date at the top and exposes Sakamichi switches', () => {
  assert.doesNotMatch(shell, /フォロワー数|amazonFollowerCount|amazonFollowerDelta/);
  assert.match(shell, /id: 'amazonAllRankChart'/);
  assert.match(shell, /amazon-summary subtle">集計日 <time id="amazonSnapshotDate">/);
  assert.doesNotMatch(shell, /trailingHtml: '<span class="subtle">集計日/);
  assert.match(shell, /data-amazon-mode="all"[\s\S]*>全楽曲順位</);
  assert.match(shell, /data-amazon-mode="titles"[\s\S]*>表題曲比較</);
  assert.match(shell, /data-amazon-mode="nogizaka"[\s\S]*>乃木坂46</);
  assert.match(shell, /data-amazon-mode="sakurazaka"[\s\S]*>櫻坂46</);
  assert.match(shell, /data-amazon-mode="hinatazaka"[\s\S]*>日向坂46</);
  assert.match(shell, /headers: \['Amazon Music総合順位', '前日比', 'アーティスト', '曲名'\]/);
});

test('Amazon Music title comparison and artist modes apply the requested table/chart scopes', () => {
  assert.match(runtime, /mode === 'titles'[\s\S]*filteredPayload\(payload, isAmazonMusicTitleTrack\)/);
  assert.match(runtime, /track\?\.group_name === group && isAmazonMusicTitleTrack\(track\)/);
  assert.match(runtime, /track\?\.group_name === group/);
  assert.match(runtime, /tableTitle: '乃木坂46 全楽曲順位'/);
  assert.match(runtime, /chartTitle: '乃木坂46 表題曲 Amazon Music総合順位推移'/);
  assert.match(runtime, /tableTitle: '櫻坂46 全楽曲順位'/);
  assert.match(runtime, /tableTitle: '日向坂46 全楽曲順位'/);
  assert.match(titleTracks, /'乃木坂46'/);
  assert.match(titleTracks, /'櫻坂46'/);
  assert.match(titleTracks, /'日向坂46'/);
  assert.match(titleTracks, /'是非に及ばず'/);
  assert.match(titleTracks, /'愛MUST BE'/);
  assert.match(titleTracks, /'クリフハンガー'/);
});

test('Amazon Music rank chart keeps first place at the top and fits mobile width', () => {
  assert.match(runtime, /yFor = \(rank\) => margin\.top \+ \(rank - 1\)/);
  assert.match(runtime, /坂道3グループ全楽曲のAmazon Music総合順位推移。1位が上。/);
  assert.match(shell, /className: 'amazon-rank-chart chart-fit'/);
  assert.match(sharedUi, /joinClasses\('shared-svg-chart', className\)/);
  assert.match(sharedCss, /\.shared-svg-chart svg[\s\S]*width:\s*100%/);
  assert.match(css, /\.amazon-table[\s\S]*table-layout:\s*fixed/);
  assert.match(css, /\.amazon-mode-switch[\s\S]*overflow-x:\s*auto/);
});
