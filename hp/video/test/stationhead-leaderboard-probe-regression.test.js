import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url), 'utf8');

test('Stationhead launches a hidden leaderboard discovery page without replacing playback', () => {
  assert.match(policy, /StationheadJuly19LeaderboardProbeScript/);
  assert.match(policy, /frame\.src = '\/leaderboard\?homepanel_probe=1&ts='/);
  assert.match(policy, /window\.top === window/);
  assert.match(policy, /document\.createElement\('iframe'\)/);
  assert.match(policy, /left:-10000px/);
});

test('leaderboard fetch and XHR responses are captured with bounded local history', () => {
  assert.match(policy, /const onBoard = \(\) =>/);
  assert.match(policy, /response\.clone\(\)\.text\(\)/);
  assert.match(policy, /this\.addEventListener\('loadend'/);
  assert.match(policy, /homepanel\.stationhead\.leaderboardProbe\.v1/);
  assert.match(policy, /body: String\(row\.body \|\| ''\)\.slice\(0, 262144\)/);
  assert.match(policy, /JSON\.stringify\(rows\.slice\(-20\)\)/);
});

test('persisted leaderboard records never contain captured credentials', () => {
  const safeRecordSection = policy.slice(
    policy.indexOf('const safe = {'),
    policy.indexOf('const rows = JSON.parse'),
  );
  assert.doesNotMatch(safeRecordSection, /authorization|sth-device-uid/i);
  assert.match(policy, /getHeader\('authorization'\)/);
  assert.match(policy, /'sth-device-uid': getHeader\('sth-device-uid'\)/);
});

test('probe also snapshots rendered weekly leaderboard text and resource URLs', () => {
  assert.match(policy, /getEntriesByType\?\.\('resource'\)/);
  assert.match(policy, /innerText \|\| ''\)\.slice\(0, 32768\)/);
  assert.match(policy, /resources/);
  assert.match(policy, /source: 'snapshot'/);
});

test('diagnostic output is bounded and uses the existing native stats channel', () => {
  assert.match(policy, /type: 'stationhead-play-stats-error'/);
  assert.match(policy, /error: 'leaderboard-probe:' \+ kind/);
  assert.match(policy, /slice\(0, 1400\)/);
});
