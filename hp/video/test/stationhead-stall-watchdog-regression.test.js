import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const watchdog = readFileSync(
  new URL('../../native/src/sh_media_stall_watchdog_policy_fix.h', import.meta.url),
  'utf8',
);
const player = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);
const nativeStats = readFileSync(
  new URL('../../native/src/stationhead_native_stats.cpp', import.meta.url),
  'utf8',
);

test('legacy page media stall watchdog is retired', () => {
  assert.match(watchdog, /Retired compatibility header/);
  assert.doesNotMatch(watchdog, /setTimeout|setInterval|querySelectorAll|location\.reload/);
  assert.doesNotMatch(watchdog, /StationheadMediaProgressWatchdogScript/);
});

test('native track-boundary recovery still owns audio liveness failure handling', () => {
  assert.match(player, /kStationheadTrackBoundaryPlaybackRecoveryTimeoutMs = 30'000/);
  assert.match(player, /void StationheadPlayer::RecoverTrackBoundaryPlayback\(\)/);
  assert.match(player, /ScheduleRecreate\([\s\S]*audio did not recover after track-boundary refresh/);
});

test('recent-hour history keeps one sample per five-minute bucket', () => {
  assert.match(nativeStats, /kHistorySampleBucketMs = 5LL \* 60 \* 1000/);
  assert.match(nativeStats, /const int64_t bucket = receivedAt \/ kHistorySampleBucketMs/);
  assert.match(nativeStats, /history_\.back\(\)\.first \/ kHistorySampleBucketMs == bucket/);
  assert.match(nativeStats, /history_\.back\(\) = sample/);
  assert.match(nativeStats, /history_\.push_back\(sample\)/);
  assert.match(nativeStats, /latest\.first - 60LL \* 60 \* 1000/);
  assert.doesNotMatch(nativeStats, /history_\.erase\(history_\.end\(\) - 2\)/);
});
