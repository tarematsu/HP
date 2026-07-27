import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handleHeader = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const playerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('Window B remains covered until its first useful surface is ready', () => {
  const readiness = section(
    handleHeader,
    'inline bool StationheadStartupPreviewReady(',
    'static_assert(SecondaryStationheadStartupReady',
  );
  assert.match(readiness, /status\.audioPlaying/);
  assert.match(readiness, /status\.loginRequired/);
  assert.match(readiness, /status\.spotifyAuthorization/);
  assert.match(readiness, /status\.created && !status\.navigating/);
  assert.match(readiness, /status\.detail == L"station loaded"/);
  assert.match(readiness, /!status\.processFailed/);

  const apply = section(
    handleHeader,
    '  void ApplyDeferredStartupPreview() {',
    '  RECT pendingStartupPreviewBounds_',
  );
  const readinessAt = apply.indexOf('StationheadStartupPreviewReady(status)');
  const exposeAt = apply.indexOf(
    'StationheadHandleBase::SetStartupPreviewBounds(pendingStartupPreviewBounds_);',
  );
  assert.ok(readinessAt >= 0 && exposeAt > readinessAt);
});

test('delayed WebView recreation keeps the App scheduler on a fast wake', () => {
  const wake = section(
    playerHeader,
    'class StartupAwareWakeDeadline',
    'struct StationheadDailyPlayPoint',
  );
  assert.match(wake, /const std::atomic<bool>& recreating/);
  assert.match(wake, /recreating_->load\(std::memory_order_relaxed\)/);
  assert.match(wake, /startupWatchdogPending \? 0 : value_/);
  assert.match(
    playerHeader,
    /StartupAwareWakeDeadline nextTickAt_\{[\s\S]*creating_, recreating_, startupScriptDeadline_/,
  );
});

test('earliest recreate request is compared in monotonic uptime space', () => {
  const deadline = section(
    playerHeader,
    'class MonotonicDeadline',
    'class StartupAwareWakeDeadline',
  );
  assert.match(deadline, /friend bool operator<\(/);
  assert.match(deadline, /TickForWallDeadline\(candidateWallDeadline\)/);
  assert.match(deadline, /current\.deadlineTick_/);

  const schedule = section(
    playerSource,
    'void StationheadPlayer::ScheduleRecreate(',
    '}  // namespace hp',
  );
  assert.match(schedule, /candidate < recreateAt_/);
});
