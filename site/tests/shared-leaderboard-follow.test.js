import { browserSource } from './helpers/dashboard-source.js';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tabs = dashboardRouterSource();
const leaderboardShell = readFileSync(new URL('../public/leaderboard-shell.js', import.meta.url), 'utf8');
const leaderboardRuntime = browserSource('leaderboard.js');
const leaderboardModel = readFileSync(new URL('../public/leaderboard-read-model.js', import.meta.url), 'utf8');
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const followersRuntime = readFileSync(new URL('../public/followers.js', import.meta.url), 'utf8');
const followersModel = readFileSync(new URL('../public/followers-read-model.js', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

test('leaderboard uses one shared shell runtime and Stationhead read model', () => {
  assert.equal((tabs.match(/leaderboard-shell\.js\?v=20261005\.2/g) || []).length, 1);
  assert.equal((tabs.match(/leaderboard\.js\?v=20261005\.2/g) || []).length, 1);
  assert.match(tabs, /ranking:[\s\S]*loadArgs: \{ source: 'stationhead' \}/);
  assert.doesNotMatch(tabs, /music-ranking|source: 'music-streaming'/);
  assert.match(leaderboardShell, /id: 'leaderboardView'/);
  assert.match(leaderboardRuntime, /leaderboardReadModel\(source\)\.load/);
  assert.match(leaderboardModel, /normalizeStationheadLeaderboard/);
  assert.doesNotMatch(leaderboardModel, /music-streaming|loadMusicServiceReadModel|amazon-music|apple-music|spotify-monthly-listeners/);
});

test('followers use one shared shell runtime and Stationhead read model', () => {
  assert.equal((tabs.match(/followers-shell\.js\?v=20261005\.2/g) || []).length, 1);
  assert.equal((tabs.match(/followers\.js\?v=20261005\.2/g) || []).length, 1);
  assert.match(tabs, /followers:[\s\S]*loadArgs: \{ source: 'stationhead' \}/);
  assert.doesNotMatch(tabs, /music-followers|source: 'music-streaming'/);
  assert.match(followersShell, /id: 'followersView'/);
  assert.match(followersRuntime, /followersReadModel\(source\)\.load/);
  assert.match(followersModel, /normalizeStationheadFollowers/);
  assert.doesNotMatch(followersModel, /music-streaming|loadMusicServiceReadModel|MUSIC_SERVICES/);
});

test('Stationhead-specific normalization stays in read-model adapters', () => {
  for (const name of ['sakuramankai', 'sakurazaka46jp', 'nogizaka46smej']) assert.match(leaderboardModel, new RegExp(name));
  for (const name of ['sakuramankai', 'sakuramankai2', 'sakurazaka46jp', 'nogizaka46smej']) assert.match(followersModel, new RegExp(name));
  assert.match(leaderboardModel, /normalizeStationheadLeaderboard/);
  assert.match(followersModel, /normalizeStationheadFollowers/);
});

test('Stationhead leaderboard preserves missing-gap and out-of-rank presentation semantics', () => {
  assert.match(leaderboardModel, /STATIONHEAD_MISSING_RANGES/);
  assert.match(leaderboardModel, /rank_status: stationheadRankStatus/);
  assert.match(leaderboardModel, /row\.rank_status !== '欠測' && row\.rank_status !== '圏外'/);
  assert.match(leaderboardModel, /missing_ranges: STATIONHEAD_MISSING_RANGES/);
  assert.match(leaderboardRuntime, /DASHBOARD_MISSING_KEY/);
  assert.match(leaderboardRuntime, /dashboardMissingIndexBands/);
  assert.match(leaderboardRuntime, /drawDashboardMissingBands/);
  assert.match(leaderboardRuntime, /appendLegendEntry\(legend, '欠測'/);
});

test('aggregate feature styles are bundled only with Stationhead', () => {
  assert.match(build, /stationhead:[\s\S]*'followers\.css'[\s\S]*'leaderboard\.css'/);
  const subscriptions = build.match(/subscriptions:\s*\[([\s\S]*?)\],/i)?.[1] || '';
  assert.doesNotMatch(subscriptions, /followers\.css|leaderboard\.css/);
});

test('leaderboard no longer participates in the history router', () => {
  assert.doesNotMatch(tabs, /const HISTORY_MODES = new Set\([^\n]*ranking/);
  assert.match(tabs, /const HISTORY_MODES = Object\.freeze\(new Set\(\['daily', 'weekly', 'monthly', 'broadcasts'\]\)\)/);
});
