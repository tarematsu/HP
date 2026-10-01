import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/followers.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/followers.css', import.meta.url), 'utf8');
const workerConfig = readFileSync(new URL('../../worker/wrangler.sakurazaka46jp.jsonc', import.meta.url), 'utf8');

const FIXED_HANDLES = ['sakuramankai', 'sakuramankai2', 'sakurazaka46jp', 'nogizaka46smej'];

test('followers is registered in the common lazy router after its shell mounts', () => {
  assert.match(entry, /followers-shell\.js/);
  assert.ok(entry.indexOf('followers-shell.js') < entry.indexOf('dashboard-tabs.js'));
  assert.match(route, /followers: \{/);
  assert.match(route, /followers\.js\?v=20260930\.3/);
  assert.match(route, /viewId: 'followersView'/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /view: 'followers'/);
  assert.match(shell, /label: 'フォロワー'/);
});

test('followers tab keeps the fixed accounts and renders a dynamic multi-series Canvas chart', () => {
  for (const handle of FIXED_HANDLES) assert.match(runtime, new RegExp(`'${handle}'`));
  assert.match(runtime, /payloadHandles\(payload\)/);
  assert.match(runtime, /handles\.forEach/);
  assert.match(runtime, /SERIES_STYLES/);
  assert.match(runtime, /getContext\('2d'\)/);
  assert.match(runtime, /devicePixelRatio/);
  assert.match(runtime, /context\.setTransform/);
  assert.match(runtime, /context\.setLineDash/);
  assert.match(shell, /<canvas id="followersChart"/);
  assert.match(shell, /class="chart-fit"/);
  assert.match(shell, /id="followersChartDetail" class="chart-detail"/);
  assert.doesNotMatch(shell, /title: 'フォロワー数推移'/);
  assert.doesNotMatch(runtime, /svgElement|createSvgNode/);
  assert.doesNotMatch(css, /followers-grid-line|followers-axis-label|followers-line-|followers-endpoint/);
  assert.match(shell, /dashboardTable/);
  assert.match(shell, /headers: \['アカウント名', 'フォロワー数', '前日比', '1週間前比'\]/);
  assert.match(shell, /bodyId: 'followersTbody'/);
  assert.match(sharedUi, /numeric && 'shared-numeric-table'/);
  assert.match(runtime, /previous_day_delta/);
  assert.match(runtime, /previous_week_delta/);
});

test('new follower targets keep pre-registration history sparse instead of inventing zeroes', () => {
  assert.match(runtime, /safeInteger as integer/);
  assert.match(runtime, /const value = followerValue\(row\?\.\[handle\]\)/);
  assert.match(runtime, /if \(value == null\) continue/);
  assert.match(runtime, /return parsed == null \? '-' :/);
});

test('followers public view reads only its materialized API and never D1', () => {
  assert.match(runtime, /fetch\('\/api\/followers'/);
  assert.doesNotMatch(runtime, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.doesNotMatch(route, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  assert.match(workerConfig, /"binding": "PAGES_RESPONSE_R2"/);
});
