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
const handleSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);
const boundaryPolicy = readFileSync(
  new URL('../../native/src/sh_track_boundary_message_policy.h', import.meta.url),
  'utf8',
);
const nativeCmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
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

test('native audio-stop ticks recover a lost page track-ended notification', () => {
  const publicRequest = section(
    playerHeader,
    'bool RetryPendingTrackBoundaryRefresh(int64_t nowMs)',
    'void CancelPendingTrackBoundaryRefresh()',
  );
  assert.match(publicRequest, /const bool retry = trackBoundaryRefreshPending_;/);
  assert.match(publicRequest, /HandleTrackEnded\(nowMs, retry\);/);
  assert.match(
    publicRequest,
    /return trackBoundaryRefreshPending_ \|\|[\s\S]*trackBoundaryPlaybackRecoveryPending_ &&[\s\S]*trackBoundaryPlaybackRecoveryAwaitingNavigation_/,
  );

  const tick = section(
    handleSource,
    'void StationheadHandleBase::Tick(int64_t nowMs)',
    'void StationheadHandleBase::Reconnect()',
  );
  assert.match(
    tick,
    /if \(!retry\.armed && !player_->AudioPlaying\(\)\) \{[\s\S]*player_->RetryPendingTrackBoundaryRefresh\(nowMs\)/,
  );
  assert.match(tick, /if \(active\) \{[\s\S]*ArmBoundaryRetryState\(this, nowMs\);/);
  assert.ok(
    tick.indexOf('!player_->AudioPlaying()') <
      tick.indexOf('player_->RetryPendingTrackBoundaryRefresh(nowMs)'),
    'the native fallback must never request a refresh while audio is playing',
  );
});

test('post-navigation audio recovery cannot be mistaken for a new refresh request', () => {
  const publicRequest = section(
    playerHeader,
    'bool RetryPendingTrackBoundaryRefresh(int64_t nowMs)',
    'void CancelPendingTrackBoundaryRefresh()',
  );
  assert.match(
    publicRequest,
    /trackBoundaryPlaybackRecoveryPending_ &&[\s\S]*trackBoundaryPlaybackRecoveryAwaitingNavigation_/,
  );
  assert.doesNotMatch(
    publicRequest,
    /return trackBoundaryRefreshPending_ \|\|\s*trackBoundaryPlaybackRecoveryPending_;/,
  );
});

test('A and B readiness messages share one monotonic ownership lease', () => {
  assert.match(
    boundaryPolicy,
    /kStationheadBoundaryWaitingLeaseMs\s*=\s*40'000/,
  );
  assert.match(
    boundaryPolicy,
    /kStationheadBoundaryCommittedLeaseMs\s*=\s*3 \* 60'000/,
  );
  assert.match(
    boundaryPolicy,
    /message == WM_HP_PRIMARY_RELOAD_READY \|\|[\s\S]*message == WM_HP_SECONDARY_RELOAD_READY/,
  );
  assert.match(boundaryPolicy, /GetTickCount64\(\)/);
  assert.doesNotMatch(boundaryPolicy, /UnixMillis\(/);
  assert.match(boundaryPolicy, /inline SRWLOCK leaseLock = SRWLOCK_INIT;/);
  assert.match(boundaryPolicy, /inline UINT ownerMessage = 0;/);
  assert.match(boundaryPolicy, /inline ULONGLONG expiresAt = 0;/);
});

test('the current role may retry while the peer is rejected until lease expiry', () => {
  const decision = section(
    boundaryPolicy,
    'inline constexpr bool StationheadBoundaryLeaseAllows(',
    'static_assert(IsStationheadBoundaryReadyMessage',
  );
  assert.match(
    decision,
    /ownerMessage == 0 \|\| ownerMessage == candidateMessage \|\|[\s\S]*now >= expiresAt/,
  );
  assert.match(
    boundaryPolicy,
    /static_assert\(!StationheadBoundaryLeaseAllows\([\s\S]*WM_HP_PRIMARY_RELOAD_READY,[\s\S]*WM_HP_SECONDARY_RELOAD_READY, 9'999\)\);/,
  );
  assert.match(
    boundaryPolicy,
    /static_assert\(StationheadBoundaryLeaseAllows\([\s\S]*WM_HP_PRIMARY_RELOAD_READY,[\s\S]*WM_HP_SECONDARY_RELOAD_READY, 10'000\)\);/,
  );
});

test('unrelated SendMessage calls retain native behavior and rejected peers do not enter App', () => {
  const wrapper = section(
    boundaryPolicy,
    'inline LRESULT SendMessageWWithStationheadBoundaryLease(',
    '}  // namespace hp',
  );
  assert.match(
    wrapper,
    /if \(!IsStationheadBoundaryReadyMessage\(message\)\) \{[\s\S]*return ::SendMessageW\(window, message, wParam, lParam\);/,
  );
  assert.match(wrapper, /if \(!allowed\) return 0;/);
  assert.ok(
    wrapper.indexOf('if (!allowed) return 0;') <
      wrapper.indexOf('const LRESULT result = ::SendMessageW'),
    'a peer request must be rejected before synchronous App dispatch',
  );
});

test('accepted navigation extends the owner lease without blocking same-role retries', () => {
  const wrapper = section(
    boundaryPolicy,
    'inline LRESULT SendMessageWWithStationheadBoundaryLease(',
    '}  // namespace hp',
  );
  assert.match(
    wrapper,
    /result != 0[\s\S]*kStationheadBoundaryCommittedLeaseMs[\s\S]*kStationheadBoundaryWaitingLeaseMs/,
  );
  assert.match(
    wrapper,
    /stationhead_boundary_message_policy::ownerMessage == message/,
  );
});

test('the serialization policy is the final HomePanel PCH layer', () => {
  assert.match(
    nativeCmake,
    /src\/sh_runtime_resource_boundary_policy_fix\.h[\s\S]*src\/sh_track_boundary_message_policy\.h[\s\S]*src\/sh\.cpp/,
  );
  assert.match(
    nativeCmake,
    /target_precompile_headers\(HomePanel PRIVATE[\s\S]*src\/sh_runtime_resource_boundary_policy_fix\.h\)[\s\S]*target_precompile_headers\(HomePanel PRIVATE[\s\S]*src\/sh_track_boundary_message_policy\.h\)/,
  );
  assert.ok(
    boundaryPolicy.indexOf('return ::SendMessageW(window, message, wParam, lParam);') <
      boundaryPolicy.indexOf('#define SendMessageW SendMessageWWithStationheadBoundaryLease'),
    'the native call must be compiled before the pass-through macro is installed',
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
  assert.match(
    tick,
    /const bool active = player_->RetryPendingTrackBoundaryRefresh\(nowMs\);/,
  );
  assert.doesNotMatch(tick, /Reconnect\(|RequestTrackBoundaryRefresh/);
  assert.match(
    tick,
    /if \(!active \|\| player_->Status\(\)\.navigating\) ClearBoundaryRetryState\(this\);/,
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

test('only an accepted due request arms the bounded retry lease', () => {
  const retry = section(
    handleSource,
    'void StationheadHandleBase::RetryPendingTrackBoundaryRefresh(int64_t nowMs)',
    'void StationheadHandleBase::CancelPendingTrackBoundaryRefresh()',
  );
  assert.match(
    retry,
    /const bool active = player_->RetryPendingTrackBoundaryRefresh\(nowMs\);/,
  );
  assert.match(retry, /if \(!active\) return;/);
  assert.ok(
    retry.indexOf('if (!active) return;') <
      retry.indexOf('ArmBoundaryRetryState(this, nowMs);'),
    'a not-yet-due native check must not create a retry lease',
  );
  assert.match(retry, /if \(player_->Status\(\)\.navigating\) ClearBoundaryRetryState\(this\);/);
});
