import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const playerHeader = source('sh.h');
const playerSource = source('sh.cpp');
const handleHeader = source('app_stationhead_handles.h');
const handleSource = source('app_stationhead_handles.cpp');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('elapsed timestamps retain monotonic duration', () => {
  const elapsed = section(playerHeader, 'class MonotonicElapsedTimestamp',
    'class AtomicMonotonicElapsedTimestamp');
  assert.match(elapsed, /initialElapsedMs_ = wallTime < wallNow/);
  assert.match(elapsed, /initialElapsedMs_ \+ elapsedSinceAssignment/);
  assert.match(elapsed, /intervalMs > elapsed \? intervalMs - elapsed : 0/);
});

test('audio start timestamps are re-projected from uptime', () => {
  const atomic = section(playerHeader, 'class AtomicMonotonicElapsedTimestamp',
    'class MonotonicDeadline');
  assert.match(atomic, /startedTick_\.store/);
  assert.match(atomic, /GetTickCount64\(\)/);
  assert.match(playerHeader, /AtomicMonotonicElapsedTimestamp audioPlayingSinceAt_;/);
});

test('player wake deadlines and per-window retry states use monotonic wrappers', () => {
  assert.match(playerHeader, /MonotonicProjectedDeadline trackBoundaryPlaybackRecoveryDeadline_;/);
  assert.match(playerHeader, /MonotonicElapsedTimestamp lastDailyPlayStatsAt_;/);
  assert.doesNotMatch(playerHeader, /lastAuthProbeAt_|authProbeInFlight_|authProbeStartedAt_/);
  assert.match(handleHeader, /MonotonicElapsedTimestamp playbackMissingSinceAt_;/);

  const retry = section(handleSource, 'struct TrackBoundaryRetryState',
    'void ClearBoundaryRetryState(');
  assert.match(retry, /MonotonicProjectedDeadline deadline;/);
  assert.match(retry, /std::map<const StationheadHandleBase\*, TrackBoundaryRetryState> boundaryRetries/);
  assert.match(retry, /BoundaryRetryStateFor/);
  assert.doesNotMatch(retry, /retryAt|secondary/);
});

test('polling and recovery expressions bind to monotonic arithmetic', () => {
  const tick = section(playerSource, 'void StationheadPlayer::Tick(int64_t nowMs)',
    'void StationheadPlayer::Reconnect()');
  assert.match(tick, /nowMs - lastDailyPlayStatsAt_ >= kStationheadDailyPlayStatsIntervalMs/);
  assert.match(tick, /lastDailyPlayStatsAt_ \+ kStationheadDailyPlayStatsIntervalMs/);
  assert.match(tick, /nowMs >= trackBoundaryPlaybackRecoveryDeadline_/);

  const gap = section(handleSource, 'bool StationheadHandleBase::SuppressTrackTransitionGap(',
    'void StationheadHandleBase::ApplyAudioState()');
  assert.match(gap, /now - playbackMissingSinceAt_ < kStationheadTrackTransitionGraceMs/);

  const handleTick = section(handleSource, 'void StationheadHandleBase::Tick(int64_t nowMs)',
    'void StationheadHandleBase::ShowAfterAudioStop()');
  assert.match(handleTick, /nowMs >= found->second\.deadline/);
  assert.match(handleTick, /BoundaryRetryStateFor\(this\)/);
  assert.doesNotMatch(handleTick, /retryAt|handoff/);
});
