import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');
const player = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url), 'utf8');

test('legacy page media stall watchdog is absent from the build', () => {
  assert.doesNotMatch(cmake, /sh_media_stall_watchdog_policy_fix\.h/);
});

test('native track-boundary recovery owns audio liveness failure handling', () => {
  assert.match(player, /kStationheadTrackBoundaryPlaybackRecoveryTimeoutMs = 30'000/);
  assert.match(player, /void StationheadPlayer::RecoverTrackBoundaryPlayback\(\)/);
  assert.match(player, /ScheduleRecreate\([\s\S]*audio did not recover after track-boundary refresh/);
});
