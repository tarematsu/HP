import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const leaderboardShell = readFileSync(new URL('../public/leaderboard-shell.js', import.meta.url), 'utf8');
const leaderboardRuntime = readFileSync(new URL('../public/leaderboard.js', import.meta.url), 'utf8');
const leaderboardModel = readFileSync(new URL('../public/leaderboard-read-model.js', import.meta.url), 'utf8');
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const followersRuntime = readFileSync(new URL('../public/followers.js', import.meta.url), 'utf8');
const followersModel = readFileSync(new URL('../public/followers-read-model.js', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

test('leaderboard uses one shell and runtime with source-specific read-model args', () => {
  assert.equal((tabs.match(/leaderboard-shell\.js\?v=20261005\.2/g) || []).length, 2);
  assert.equal((tabs.match(/leaderboard\.js\?v=20261005\.2/g) || []).length, 2);
  assert.match(tabs, /ranking:[\s\S]*loadArgs: \{ source: 'stationhead' \}/);
  assert.match(tabs, /'music-ranking':[\s\S]*loadArgs: \{ source: 'music-streaming' \}/);
  assert.match(leaderboardShell, /id: 'leaderboardView'/);
  assert.match(leaderboardRuntime, /leaderboardReadModel\(source\)\.load/);
  assert.doesNotMatch(leaderboardRuntime, /sakuramankai|sakurazaka46jp|nogizaka46smej|amazon_rank|popularity_rank/);
});

test('follow uses one shell and runtime with source-specific read-model args', () => {
  assert.equal((tabs.match(/followers-shell\.js\?v=20261005\.2/g) || []).length, 2);
  assert.equal((tabs.match(/followers\.js\?v=20261005\.2/g) || []).length, 2);
  assert.match(tabs, /followers:[\s\S]*loadArgs: \{ source: 'stationhead' \}/);
  assert.match(tabs, /'music-followers':[\s\S]*loadArgs: \{ source: 'music-streaming' \}/);
  assert.match(followersShell, /id: 'followersView'/);
  assert.match(followersRuntime, /followersReadModel\(source\)\.load/);
  assert.doesNotMatch(followersRuntime, /sakuramankai|sakurazaka46jp|nogizaka46smej|STATIONHEAD_MEMBERSHIPS/);
});

test('Stationhead-specific normalization is confined to adapters', () => {
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

test('music streaming adapters reuse materialized public read models and never query D1', () => {
  assert.match(leaderboardModel, /loadMusicServiceReadModel\(service\)/);
  assert.match(leaderboardModel, /fetchJson\('\/api\/amazon-music'/);
  assert.match(leaderboardModel, /fetchJson\('\/api\/apple-music'/);
  assert.match(leaderboardModel, /fetchJson\('\/api\/spotify-monthly-listeners'/);
  assert.match(followersModel, /loadMusicServiceReadModel\(service\)/);
  for (const source of [leaderboardModel, followersModel, leaderboardRuntime, followersRuntime]) {
    assert.doesNotMatch(source, /OTHER_DB|MINUTE_DB|\.prepare\(/);
  }
});

test('shared feature styles are included in both section bundles', () => {
  assert.match(build, /stationhead:[\s\S]*'followers\.css'[\s\S]*'leaderboard\.css'/);
  assert.match(build, /subscriptions:[\s\S]*'followers\.css'[\s\S]*'leaderboard\.css'/);
});

test('leaderboard no longer participates in the history router', () => {
  assert.doesNotMatch(tabs, /const HISTORY_MODES = new Set\([^\n]*ranking/);
  assert.match(tabs, /const HISTORY_MODES = new Set\(\['daily', 'weekly', 'monthly', 'broadcasts'\]\)/);
});
