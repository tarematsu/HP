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

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('backdated elapsed timestamps retain their initial elapsed duration', () => {
  const elapsed = section(
    playerHeader,
    'class MonotonicElapsedTimestamp',
    'class MonotonicDeadline',
  );
  assert.match(elapsed, /initialElapsedMs_ = wallTime < wallNow/);
  assert.match(elapsed, /initialElapsedMs_ \+ elapsedSinceAssignment/);
  assert.match(elapsed, /friend int64_t operator\+\(/);
  assert.match(elapsed, /intervalMs > elapsed \? intervalMs - elapsed : 0/);
  assert.match(elapsed, /wallNow \+ remaining/);
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
});
