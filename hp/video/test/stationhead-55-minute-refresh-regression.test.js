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

test('Stationhead reload is driven by one 55-minute elapsed-time interval', () => {
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.match(injected, /kPeriodicRefreshIntervalMs\s*=\s*55 \* 60'000/);
  assert.match(injected, /nowMs - periodicRefreshStartedAt_ < kPeriodicRefreshIntervalMs/);
  assert.match(injected, /NavigateCurrentUrl\(nowMs, L"55-minute periodic refresh"\)/);
  assert.doesNotMatch(injected, /52 \* 60'000|track-boundary authentication refresh/);
});

test('the central scheduler wakes at the next 55-minute deadline', () => {
  const wake = section(policy, '#define NextWakeAt()', '#define RecoverUnavailableAuthorization()');
  assert.match(wake, /NextWakeAtBase\(\)/);
  assert.match(wake, /periodicRefreshStartedAt_ \+ kPeriodicRefreshIntervalMs/);
  assert.match(wake, /if \(next <= 0 \|\| due < next\) next = due;/);
});

test('periodic reload ignores playback and track transition state', () => {
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.doesNotMatch(injected, /audioPlaying_|AudioPlaying|trackBoundary|track-ended|media|ended/);
  assert.match(injected, /navigationInFlight_/);
  assert.match(injected, /status_\.navigating/);
  assert.match(injected, /spotifyAuthorization_ \|\| loginRequired_/);
});

test('Spotify auth does not masquerade as playback navigation', () => {
  const decision = section(
    policy,
    'inline constexpr bool StationheadPlaybackNavigationActive(',
    '}  // namespace hp',
  );
  assert.match(
    decision,
    /return navigationInFlight \|\| \(statusNavigating && !spotifyAuthorization\);/,
  );
  assert.match(
    policy,
    /static_assert\(!StationheadPlaybackNavigationActive\(false, true, true\)\);/,
  );
  assert.match(
    policy,
    /static_assert\(StationheadPlaybackNavigationActive\(true, true, true\)\);/,
  );

  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.match(
    injected,
    /StationheadPlaybackNavigationActive\([\s\S]*navigationInFlight_\.load[\s\S]*statusNavigating, spotifyAuthorization_\)/,
  );
  assert.ok(
    injected.indexOf('StationheadPlaybackNavigationActive(') <
      injected.indexOf('spotifyAuthorization_ || loginRequired_'),
    'a real playback navigation must still reset the clock when auth overlaps it',
  );
});

test('playback navigation starts are recorded even when they finish between App ticks', () => {
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
  assert.match(proxy, /bool load\(std::memory_order order\) const noexcept/);
  assert.match(
    policy,
    /#define navigationInFlight_[\s\S]*StationheadNavigationInFlightStorage\([\s\S]*periodicRefreshStartedAt_[\s\S]*periodicRefreshNavigationObserved_/,
  );
});

test('every completed playback navigation restarts the simple 55-minute clock', () => {
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.match(injected, /if \(navigationActive\) \{[\s\S]*periodicRefreshStartedAt_ = 0;[\s\S]*periodicRefreshNavigationObserved_ = 1;/);
  assert.match(injected, /periodicRefreshNavigationObserved_ != 0 \|\|[\s\S]*!periodicRefreshStartedAt_\.Active\(\)[\s\S]*periodicRefreshStartedAt_ = nowMs;/);
});

test('the existing handle tick invokes the elapsed-time policy', () => {
  const wrapper = section(policy, '#define RecoverUnavailableAuthorization()', '#define RetryPendingTrackBoundaryRefresh');
  assert.match(wrapper, /RecoverUnavailableAuthorizationBase\(\);/);
  assert.match(wrapper, /RefreshPeriodicNavigation\(UnixMillis\(\)\);/);
});

test('native audio-stop fallback can no longer request a boundary reload', () => {
  const disabled = section(policy, '#define RetryPendingTrackBoundaryRefresh', '#define nextAutoClickAt_');
  assert.match(disabled, /trackBoundaryRefreshPending_ = false;/);
  assert.match(disabled, /return false;/);
  assert.match(disabled, /RetryPendingTrackBoundaryRefreshDisabled/);
});

test('page media events and legacy strings cannot initiate reload', () => {
  assert.match(trackScript, /StationheadTrackBoundaryScript\(const wchar_t\*\)[\s\S]*return \{\};/);
  assert.doesNotMatch(trackScript, /addEventListener\(['"]ended|track-ended|postMessage/);
  assert.match(trackScript, /#define HandleTrackEnded\(\.\.\.\) \(\(void\)0\)/);
  assert.match(webviewSource, /HandleTrackEnded\(UnixMillis\(\), false\)/);
  assert.match(webviewSource, /HandleTrackEnded\(UnixMillis\(\), true\)/);
});

test('legacy 52-minute implementation is not called by the active policy', () => {
  assert.match(playerSource, /void StationheadPlayer::HandleTrackEnded/);
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.doesNotMatch(injected, /HandleTrackEnded|SendMessageW|RELOAD_READY/);
});
