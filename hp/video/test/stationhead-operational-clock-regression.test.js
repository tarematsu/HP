import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);
const handleHeader = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const handleSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);
const appHeader = readFileSync(
  new URL('../../native/src/app.h', import.meta.url),
  'utf8',
);
const appMessages = readFileSync(
  new URL('../../native/src/app_messages.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

// These source-contract tests keep uptime-based operational scheduling separate
// from persisted UTC event timestamps. They intentionally cover only timers
// converted in this change set.
test('backdated elapsed timestamps retain their initial elapsed duration', () => {
  const elapsed = section(
    playerHeader,
    'class MonotonicElapsedTimestamp',
    'class AtomicMonotonicElapsedTimestamp',
  );
  assert.match(elapsed, /initialElapsedMs_ = wallTime < wallNow/);
  assert.match(elapsed, /initialElapsedMs_ \+ elapsedSinceAssignment/);
  assert.match(elapsed, /friend int64_t operator\+\(/);
  assert.match(elapsed, /intervalMs > elapsed \? intervalMs - elapsed : 0/);
  assert.match(elapsed, /wallNow \+ remaining/);
});

test('atomic audio start timestamps are re-projected from uptime', () => {
  const atomicElapsed = section(
    playerHeader,
    'class AtomicMonotonicElapsedTimestamp',
    'class MonotonicDeadline',
  );
  assert.match(atomicElapsed, /void store\(/);
  assert.match(atomicElapsed, /int64_t load\(/);
  assert.match(atomicElapsed, /startedTick_\.store/);
  assert.match(atomicElapsed, /GetTickCount64\(\)/);
  assert.match(atomicElapsed, /return wallNow - static_cast<int64_t>\(elapsed\);/);
  assert.match(
    playerHeader,
    /AtomicMonotonicElapsedTimestamp audioPlayingSinceAt_;/,
  );
});

test('ordinary player wake deadlines are re-projected from uptime', () => {
  const projected = section(
    playerHeader,
    'class MonotonicProjectedDeadline',
    'class StartupAwareWakeDeadline',
  );
  assert.match(projected, /deadline_\.ProjectedWallDeadline\(\)/);

  const wake = section(
    playerHeader,
    'class StartupAwareWakeDeadline',
    'struct StationheadDailyPlayPoint',
  );
  assert.match(wake, /MonotonicProjectedDeadline value_;/);
  assert.match(wake, /static_cast<int64_t>\(value_\)/);
});

test('track-boundary and periodic operational clocks use monotonic wrappers', () => {
  assert.match(
    playerHeader,
    /MonotonicProjectedDeadline trackBoundaryPlaybackRecoveryDeadline_;/,
  );
  assert.match(
    playerHeader,
    /MonotonicElapsedTimestamp lastDailyPlayStatsAt_;/,
  );
  assert.match(
    playerHeader,
    /MonotonicElapsedTimestamp lastAuthProbeAt_;/,
  );
  assert.match(
    playerHeader,
    /MonotonicElapsedTimestamp authProbeStartedAt_;/,
  );
  assert.match(
    handleHeader,
    /MonotonicElapsedTimestamp playbackMissingSinceAt_;/,
  );

  const retryState = section(
    handleSource,
    'struct TrackBoundaryRetryState',
    'TrackBoundaryRetryState primaryBoundaryRetry',
  );
  assert.match(retryState, /MonotonicProjectedDeadline retryAt;/);
  assert.match(retryState, /MonotonicProjectedDeadline deadline;/);

  for (const field of [
    'primaryTrackBoundaryPendingUntil_',
    'secondaryTrackBoundaryPendingUntil_',
    'primaryTrackBoundaryHandoffReadyAt_',
    'secondaryTrackBoundaryHandoffReadyAt_',
  ]) {
    assert.match(
      appHeader,
      new RegExp(`MonotonicProjectedDeadline ${field};`),
    );
  }
});

test('existing polling and recovery expressions bind to monotonic arithmetic', () => {
  const tick = section(
    playerSource,
    'void StationheadPlayer::Tick(int64_t nowMs)',
    'void StationheadPlayer::Reconnect()',
  );
  assert.match(
    tick,
    /nowMs - lastDailyPlayStatsAt_ >= kStationheadDailyPlayStatsIntervalMs/,
  );
  assert.match(
    tick,
    /lastDailyPlayStatsAt_ \+ kStationheadDailyPlayStatsIntervalMs/,
  );
  assert.match(tick, /nowMs - authProbeStartedAt_ >= kAuthProbeTimeoutMs/);
  assert.match(tick, /lastAuthProbeAt_ \+ kAuthProbeIntervalMs/);
  assert.match(tick, /nowMs >= trackBoundaryPlaybackRecoveryDeadline_/);

  const transitionGap = section(
    handleSource,
    'bool StationheadHandleBase::SuppressTrackTransitionGap(',
    'void StationheadHandleBase::ApplyAudioState()',
  );
  assert.match(
    transitionGap,
    /now - playbackMissingSinceAt_ < kStationheadTrackTransitionGraceMs/,
  );

  const retryTick = section(
    handleSource,
    'void StationheadHandleBase::Tick(int64_t nowMs)',
    'void StationheadHandleBase::Reconnect()',
  );
  assert.match(retryTick, /nowMs >= retry\.deadline/);
  assert.match(retryTick, /nowMs < retry\.retryAt/);

  const appPending = section(
    appMessages,
    'void App::ProcessPendingStationheadTrackBoundaryRefreshes(int64_t nowMs)',
    'LRESULT App::HandleMessage(',
  );
  assert.match(appPending, /auto& pendingUntil/);
  assert.match(appPending, /auto& handoffReadyAt/);
  assert.match(
    appPending,
    /TrackBoundaryPendingActionFor\(\s*nowMs, pendingUntil, handoffReadyAt/,
  );
});
