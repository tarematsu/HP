import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_track_boundary_message_policy.h', import.meta.url),
  'utf8',
);
const trackScript = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('Window A refreshes at 55 minutes and Window B at 56 minutes', () => {
  const interval = section(
    policy,
    'inline constexpr int64_t StationheadPeriodicRefreshIntervalMs(',
    'static_assert(StationheadPlaybackNavigationActive',
  );
  assert.match(interval, /secondary \? 56 : 55/);
  assert.match(
    policy,
    /static_assert\(StationheadPeriodicRefreshIntervalMs\(false\) == 55 \* 60'000\);/,
  );
  assert.match(
    policy,
    /static_assert\(StationheadPeriodicRefreshIntervalMs\(true\) == 56 \* 60'000\);/,
  );
});

test('the central scheduler uses the role-specific elapsed-time deadline', () => {
  const wake = section(
    policy,
    '#define NextWakeAt()',
    '#define RecoverUnavailableAuthorization()',
  );
  assert.match(wake, /NextWakeAtBase\(\)/);
  assert.match(
    wake,
    /periodicRefreshStartedAt_ \+[\s\S]*StationheadPeriodicRefreshIntervalMs\(IsSecondary\(\)\)/,
  );
  assert.doesNotMatch(wake, /Handoff|handoff|NavigationPending/);
});

test('periodic refresh does not alter audio state or acquire an A-B lease', () => {
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.doesNotMatch(injected, /ApplyAudioPlaybackState/);
  assert.doesNotMatch(injected, /SendMessageWWithStationheadBoundaryLease/);
  assert.doesNotMatch(injected, /WM_HP_PRIMARY_RELOAD_READY|WM_HP_SECONDARY_RELOAD_READY/);
  assert.doesNotMatch(injected, /periodicRefreshHandoffPending_|periodicRefreshProjectedStopped_/);
});

test('each role navigates with its own refresh reason', () => {
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.match(
    injected,
    /StationheadPeriodicRefreshIntervalMs\(IsSecondary\(\)\)/,
  );
  assert.match(injected, /L"56-minute periodic refresh"/);
  assert.match(injected, /L"55-minute periodic refresh"/);
  assert.match(
    injected,
    /nowMs - periodicRefreshStartedAt_ < intervalMs/,
  );
});

test('Spotify auth does not masquerade as playback navigation', () => {
  const decision = section(
    policy,
    'inline constexpr bool StationheadPlaybackNavigationActive(',
    'inline constexpr int64_t StationheadPeriodicRefreshIntervalMs(',
  );
  assert.match(
    decision,
    /return navigationInFlight \|\| \(statusNavigating && !spotifyAuthorization\);/,
  );
  assert.match(
    policy,
    /static_assert\(!StationheadPlaybackNavigationActive\(false, true, true\)\);/,
  );
});

test('playback navigation starts restart the role-specific periodic clock', () => {
  const proxy = section(
    policy,
    'class StationheadNavigationInFlightProxy',
    'class StationheadBoundaryReloadClockProxy',
  );
  assert.match(proxy, /void store\(bool value, std::memory_order order\)/);
  assert.match(
    proxy,
    /if \(value\) \{[\s\S]*refreshStartedAt_ = 0;[\s\S]*navigationObserved_ = 1;[\s\S]*storage_\.store\(value, order\);/,
  );
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.match(
    injected,
    /if \(navigationActive\) \{[\s\S]*periodicRefreshStartedAt_ = 0;[\s\S]*periodicRefreshNavigationObserved_ = 1;/,
  );
  assert.match(
    injected,
    /periodicRefreshNavigationObserved_ != 0 \|\|[\s\S]*!periodicRefreshStartedAt_\.Active\(\)[\s\S]*periodicRefreshStartedAt_ = nowMs;/,
  );
});

test('the existing handle tick invokes the elapsed-time policy', () => {
  const wrapper = section(
    policy,
    '#define RecoverUnavailableAuthorization()',
    '#define RetryPendingTrackBoundaryRefresh',
  );
  assert.match(wrapper, /RecoverUnavailableAuthorizationBase\(\);/);
  assert.match(wrapper, /RefreshPeriodicNavigation\(UnixMillis\(\)\);/);
});

test('native audio-stop fallback can no longer request a boundary reload', () => {
  const disabled = section(
    policy,
    '#define RetryPendingTrackBoundaryRefresh',
    '#define nextAutoClickAt_',
  );
  assert.match(disabled, /trackBoundaryRefreshPending_ = false;/);
  assert.match(disabled, /return false;/);
  assert.match(disabled, /RetryPendingTrackBoundaryRefreshDisabled/);
});

test('page media events and legacy strings cannot initiate reload', () => {
  assert.match(
    trackScript,
    /StationheadTrackBoundaryScript\(const wchar_t\*\)[\s\S]*return \{\};/,
  );
  assert.match(trackScript, /Window A uses 55 minutes and Window B uses 56 minutes/);
  assert.doesNotMatch(trackScript, /addEventListener\(['"]ended|track-ended|postMessage/);
  assert.match(trackScript, /#define HandleTrackEnded\(\.\.\.\) \(\(void\)0\)/);
  assert.match(webviewSource, /HandleTrackEnded\(UnixMillis\(\), false\)/);
  assert.match(webviewSource, /HandleTrackEnded\(UnixMillis\(\), true\)/);
});

test('legacy 52-minute implementation is not called by the active policy', () => {
  assert.match(playerSource, /void StationheadPlayer::HandleTrackEnded/);
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.doesNotMatch(injected, /HandleTrackEnded|52 \* 60'000/);
});
