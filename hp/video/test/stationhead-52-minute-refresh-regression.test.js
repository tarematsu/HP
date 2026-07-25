import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
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

test('52-minute eligibility remains anchored to the last accepted reload', () => {
  assert.match(
    playerSource,
    /kStationheadTrackBoundaryRefreshDelayMs\s*=\s*52 \* 60'000/,
  );
  assert.match(
    playerSource,
    /nowMs - lastReloadAt_ < kStationheadTrackBoundaryRefreshDelayMs/,
  );
  assert.match(
    playerSource,
    /lastReloadAt_ = nowMs;[\s\S]*NavigateCurrentUrl\(nowMs, L"track-boundary authentication refresh"\)/,
  );
});

test('expired App handoff windows preserve the same player request for bounded retry', () => {
  assert.match(handleSource, /kStationheadBoundaryRetryDelayMs\s*=\s*5'000/);
  assert.match(
    handleSource,
    /kStationheadBoundaryRetryWindowMs\s*=\s*3 \* 60'000/,
  );
  assert.match(handleSource, /bool detachedFromAppWindow = false;/);

  const cancel = section(
    handleSource,
    'void StationheadHandleBase::CancelPendingTrackBoundaryRefresh() noexcept',
    'void StationheadHandleBase::SetPlaybackFallback(',
  );
  assert.match(
    cancel,
    /retry\.armed && !player_->AudioPlaying\(\) && nowMs < retry\.deadline/,
  );
  assert.match(cancel, /retry\.detachedFromAppWindow = true;/);
  assert.match(
    cancel,
    /retry\.retryAt = nowMs \+ kStationheadBoundaryRetryDelayMs/,
  );
  assert.match(cancel, /player_->RequestImmediateTick\(\);/);
  assert.ok(
    cancel.indexOf('retry.detachedFromAppWindow = true;') <
      cancel.indexOf('player_->CancelPendingTrackBoundaryRefresh();'),
    'the player pending bit must remain set while the retry lease is valid',
  );
});

test('detached retries re-open the App handoff window without resetting 52-minute state', () => {
  const tick = section(
    handleSource,
    'void StationheadHandleBase::Tick(int64_t nowMs)',
    'void StationheadHandleBase::Reconnect()',
  );
  assert.match(
    tick,
    /if \(!retry\.detachedFromAppWindow \|\| nowMs < retry\.retryAt\) return;/,
  );
  assert.match(tick, /retry\.detachedFromAppWindow = false;/);
  assert.match(tick, /player_->RetryPendingTrackBoundaryRefresh\(nowMs\);/);
  assert.doesNotMatch(tick, /Reconnect\(|RequestTrackBoundaryRefresh/);
  assert.match(
    tick,
    /if \(player_->Status\(\)\.navigating\) ClearBoundaryRetryState\(this\);/,
  );
});

test('retry deadlines participate in the central scheduler', () => {
  const nextWake = section(
    handleSource,
    'int64_t StationheadHandleBase::NextWakeAt() const noexcept',
    'void StationheadHandleBase::RefreshVisibility()',
  );
  assert.match(nextWake, /retry\.armed && retry\.detachedFromAppWindow/);
  assert.match(nextWake, /retry\.retryAt < next/);
  assert.match(nextWake, /next = retry\.retryAt;/);
});

test('recovery, navigation, auth and lifecycle changes cancel stale retry leases', () => {
  const tick = section(
    handleSource,
    'void StationheadHandleBase::Tick(int64_t nowMs)',
    'void StationheadHandleBase::Reconnect()',
  );
  assert.match(
    tick,
    /player_->AudioPlaying\(\) \|\| status\.navigating \|\|[\s\S]*RequiresInteractiveStationhead\(status\) \|\| nowMs >= retry\.deadline/,
  );
  assert.match(tick, /player_->CancelPendingTrackBoundaryRefresh\(\);/);
  assert.match(tick, /ClearBoundaryRetryState\(this\);/);

  for (const method of [
    'void StationheadHandleBase::Stop()',
    'void StationheadHandleBase::Start()',
    'void StationheadHandleBase::Reconnect()',
    'void StationheadHandleBase::AssignPlayer(',
    'void StationheadHandleBase::ResetPlayer()',
  ]) {
    const startAt = handleSource.indexOf(method);
    assert.notEqual(startAt, -1, `missing lifecycle method: ${method}`);
    const slice = handleSource.slice(startAt, startAt + 700);
    assert.match(slice, /ClearBoundaryRetryState\(this\);/);
  }
});

test('successful navigation stops the retry lease immediately', () => {
  const retry = section(
    handleSource,
    'void StationheadHandleBase::RetryPendingTrackBoundaryRefresh(int64_t nowMs)',
    'void StationheadHandleBase::CancelPendingTrackBoundaryRefresh()',
  );
  assert.match(retry, /ArmBoundaryRetryState\(this, nowMs\);/);
  assert.match(retry, /player_->RetryPendingTrackBoundaryRefresh\(nowMs\);/);
  assert.match(
    retry,
    /if \(player_->Status\(\)\.navigating\) ClearBoundaryRetryState\(this\);/,
  );
});
