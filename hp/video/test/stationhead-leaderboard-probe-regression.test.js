import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url), 'utf8');

test('authenticated Stationhead session launches a hidden leaderboard discovery page', () => {
  assert.match(policy, /startLeaderboardProbe\(\)/);
  assert.match(policy, /frame\.src = '\/leaderboard\?homepanel_probe=1&ts='/);
  assert.match(policy, /window\.top !== window/);
  assert.match(policy, /__homepanelStationheadAuthHeaders\?\.authorization/);
  assert.match(policy, /frame\.style\.cssText = 'position:fixed!important;left:-10000px/);
});

test('leaderboard page traffic is captured without persisting auth headers', () => {
  assert.match(policy, /const leaderboardPage = \(\) =>/);
  assert.match(policy, /response\.clone\(\)\.text\(\)/);
  assert.match(policy, /this\.addEventListener\('loadend'/);
  assert.match(policy, /homepanel\.stationhead\.leaderboardProbe\.v1/);
  assert.match(policy, /body: String\(record\?\.body \|\| ''\)\.slice\(0, 262144\)/);

  const safeRecordSection = policy.slice(
    policy.indexOf('const safe = {'),
    policy.indexOf('const records = Array.isArray'),
  );
  assert.doesNotMatch(safeRecordSection, /authorization|sth-device-uid/i);
});

test('probe snapshots rendered data and attempts a read-only replay of a rank-like API', () => {
  assert.match(policy, /getEntriesByType\?\.\('resource'\)/);
  assert.match(policy, /production1\\\.stationhead\\\.com/);
  assert.match(policy, /leaderboard\|ranking\|rank\|weekly\|week\|chart\|top/);
  assert.match(policy, /method: 'GET', credentials: 'include', cache: 'no-store'/);
  assert.match(policy, /source: 'replay'/);
  assert.doesNotMatch(policy, /method: 'POST'.*leaderboard/s);
});

test('diagnostic messages reuse the existing bounded native stats error channel', () => {
  assert.match(policy, /type: 'stationhead-play-stats-error'/);
  assert.match(policy, /error: 'leaderboard-probe:' \+ kind/);
  assert.match(policy, /slice\(0, 1400\)/);
});
