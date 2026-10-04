import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/followers.js', import.meta.url), 'utf8');
const readModel = readFileSync(new URL('../public/followers-read-model.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/followers.css', import.meta.url), 'utf8');
const workerConfig = readFileSync(new URL('../../worker/wrangler.sakurazaka46jp.jsonc', import.meta.url), 'utf8');

const FIXED_HANDLES = ['sakuramankai', 'sakuramankai2', 'sakurazaka46jp', 'nogizaka46smej'];

test('Stationhead and music streaming follow routes share one shell and runtime', () => {
  assert.doesNotMatch(entry, /followers-shell\.js/);
  assert.match(route, /followers:\s*\{[\s\S]*viewId: 'followersView'[\s\S]*followers-shell\.js\?v=20261005\.2[\s\S]*followers\.js\?v=20261005\.2[\s\S]*source: 'stationhead'/);
  assert.match(route, /'music-followers':\s*\{[\s\S]*viewId: 'followersView'[\s\S]*followers-shell\.js\?v=20261005\.2[\s\S]*followers\.js\?v=20261005\.2[\s\S]*source: 'music-streaming'/);
  assert.match(route, /id: 'followers', label: 'フォロワー', defaultMode: 'followers'/);
  assert.match(route, /id: 'music-followers', label: 'フォロー', defaultMode: 'music-followers'/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /id: 'followersView'/);
});

test('follower shell is source-neutral and exposes dynamic metadata and table headings', () => {
  assert.match(shell, /id="followersCompactMeta" class="regional-chart-meta"/);
  assert.match(shell, /id="followersUpdatedAt"/);
  assert.match(shell, /id="followersCadence"/);
  assert.match(shell, /headId: 'followersThead'/);
  assert.match(shell, /bodyId: 'followersTbody'/);
  assert.match(shell, /titleId: 'followersChartTitle'/);
  assert.match(shell, /titleId: 'followersTableTitle'/);
  assert.doesNotMatch(shell, /STATIONHEAD FOLLOWERS|毎日00:00|sakuramankai/);
});

test('source-specific Stationhead follower metadata lives only in the adapter', () => {
  for (const handle of FIXED_HANDLES) {
    assert.match(readModel, new RegExp(`'${handle}'`));
    assert.doesNotMatch(runtime, new RegExp(handle));
  }
  for (const label of ['櫻坂46公式', '乃木坂46公式', 'Buddies']) assert.match(readModel, new RegExp(label));
  assert.match(readModel, /STATIONHEAD_MEMBERSHIPS/);
  assert.match(readModel, /GROUP_COLORS/);
  assert.match(readModel, /FAN_DASHES/);
  assert.match(readModel, /normalizeStationheadFollowers/);
  assert.doesNotMatch(runtime, /DEFAULT_HANDLES|FALLBACK_MEMBERSHIPS|STATIONHEAD_MEMBERSHIPS/);
});

test('shared follower runtime renders normalized accounts through the common Canvas foundation', () => {
  assert.match(runtime, /followersReadModel\(source\)\.load/);
  assert.match(runtime, /account\.label/);
  assert.match(runtime, /account\.affiliation/);
  assert.match(runtime, /row\?\.values\?\.\[id\]/);
  assert.match(runtime, /dashboard-chart-canvas\.js\?v=20261001\.2/);
  for (const helper of ['prepareDashboardCanvas', 'drawDashboardGrid', 'drawDashboardLine', 'drawDashboardXAxis', 'dashboardTickIndexes']) {
    assert.match(runtime, new RegExp(helper));
  }
  assert.match(runtime, /lineDash: style\.dash/);
  assert.match(shell, /<canvas id="followersChart"/);
  assert.match(shell, /id="followersChartDetail" class="chart-detail"/);
  assert.match(css, /followers-affiliation/);
});

test('music streaming follow adapter uses materialized service read models and never D1', () => {
  for (const service of ['youtube_music', 'kkbox', 'qq_music', 'kugou_music']) {
    assert.match(readModel, new RegExp(`'${service}'`));
  }
  assert.match(readModel, /loadMusicServiceReadModel\(service\)/);
  assert.match(readModel, /row\?\.followers/);
  assert.doesNotMatch(readModel, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.doesNotMatch(runtime, /OTHER_DB|MINUTE_DB|\.prepare\(/);
});

test('Stationhead follower adapter reads only the materialized public API', () => {
  assert.match(readModel, /loadDashboardJson\('\/api\/followers'/);
  assert.doesNotMatch(route, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.match(workerConfig, /"binding": "PAGES_RESPONSE_R2"/);
});
