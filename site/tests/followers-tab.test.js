import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ROUTES, navigationForMode } from '../public/dashboard-navigation-config.js';
import { normalizeStationheadFollowers } from '../public/followers-read-model.js';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const route = dashboardRouterSource();
const shell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/followers.js', import.meta.url), 'utf8');
const readModel = readFileSync(new URL('../public/followers-read-model.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/followers.css', import.meta.url), 'utf8');
const workerConfig = readFileSync(new URL('../../worker/wrangler.sakurazaka46jp.jsonc', import.meta.url), 'utf8');

const FIXED_HANDLES = ['sakuramankai', 'sakuramankai2', 'sakurazaka46jp', 'nogizaka46smej'];

test('Stationhead followers use one lazy shell and runtime', () => {
  assert.doesNotMatch(entry, /followers-shell\.js/);
  assert.equal(ROUTES.followers.kind, 'lazy');
  assert.equal(ROUTES.followers.viewId, 'followersView');
  assert.equal(ROUTES.followers.moduleId, 'followers');
  assert.deepEqual(ROUTES.followers.loadArgs, { source: 'stationhead' });
  assert.equal(navigationForMode('followers').item.label, 'フォロワー');
  assert.doesNotMatch(route, /music-followers|source: 'music-streaming'/);
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

test('Stationhead follower adapter has no retired streaming aggregation or browser D1 path', () => {
  assert.match(readModel, /loadDashboardJson\('\/api\/followers'/);
  for (const source of [readModel, runtime]) {
    assert.doesNotMatch(source, /loadMusicServiceReadModel|OTHER_DB|MINUTE_DB|\.prepare\(/);
  }
});

test('Stationhead follower adapter reads only the materialized public API', () => {
  assert.match(readModel, /loadDashboardJson\('\/api\/followers'/);
  assert.doesNotMatch(route, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.match(workerConfig, /"binding": "PAGES_RESPONSE_R2"/);
});


test('nogifan1ch is always presented as Nogizaka even when an older payload says Buddies', () => {
  const model = normalizeStationheadFollowers({
    handles: ['nogifan1ch'],
    rows: [{ date: '2026-10-06', nogifan1ch: 123 }],
    accounts: [{ handle: 'nogifan1ch', followers: 123, affiliation: 'Buddies', group: 'sakurazaka46' }],
    memberships: { nogifan1ch: { affiliation: 'Buddies', group: 'sakurazaka46' } },
  });
  const account = model.accounts.find((row) => row.id === 'nogifan1ch');
  assert.equal(account?.affiliation, 'Nogizaka');
  assert.equal(account?.group, 'nogizaka46');
});
