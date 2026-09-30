import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../public/dashboard-followers-route.js', import.meta.url), 'utf8');
const sharedRoute = readFileSync(new URL('../public/dashboard-standalone-route.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/followers.js', import.meta.url), 'utf8');
const workerConfig = readFileSync(new URL('../../worker/wrangler.sakurazaka46jp.jsonc', import.meta.url), 'utf8');

const FIXED_HANDLES = ['sakuramankai', 'sakuramankai2', 'sakurazaka46jp', 'nogizaka46smej'];

test('followers tab is isolated from the existing music-tab router while reusing shared route infrastructure', () => {
  assert.match(entry, /dashboard-followers-route\.js\?v=20260930\.2/);
  assert.ok(entry.indexOf('dashboard-followers-route.js') < entry.indexOf('dashboard-tabs.js'));
  assert.match(route, /followers-shell\.js\?v=20260930\.3/);
  assert.match(route, /followers\.js\?v=20260930\.3/);
  assert.match(route, /registerStandaloneDashboardRoute/);
  assert.match(route, /mode: 'followers'/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /view: 'followers'/);
  assert.match(shell, /label: 'フォロワー'/);
  assert.match(sharedUi, /export function mountDashboardShell/);
});

test('shared standalone routing hides a lazy view before another route is shown', () => {
  assert.match(sharedRoute, /function deactivate\(\)/);
  assert.match(sharedRoute, /if \(node\) node\.hidden = true/);
  assert.match(sharedRoute, /function leaveForLocation\(\)[\s\S]*deactivate\(\)/);
  assert.match(sharedRoute, /if \(active && event\.target\.closest\('#modeTabs button'\)\) deactivate\(\)/);
});

test('followers tab keeps the fixed accounts and renders a dynamic multi-series chart', () => {
  for (const handle of FIXED_HANDLES) assert.match(runtime, new RegExp(`'${handle}'`));
  assert.match(runtime, /payloadHandles\(payload\)/);
  assert.match(runtime, /handles\.forEach/);
  assert.match(runtime, /seriesIndex % 4/);
  assert.match(shell, /dashboardChartHost/);
  assert.match(shell, /id: 'followersChart'/);
  assert.match(sharedUi, /joinClasses\('shared-svg-chart', className\)/);
  assert.match(runtime, /followers-line-/);
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
