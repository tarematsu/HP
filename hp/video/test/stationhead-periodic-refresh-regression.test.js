import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const configHeader = readFileSync(
  new URL('../../native/src/config.h', import.meta.url),
  'utf8',
);
const cloudConfig = readFileSync(
  new URL('../../native/src/cloud_config.cpp', import.meta.url),
  'utf8',
);
const appHeader = readFileSync(
  new URL('../../native/src/app.h', import.meta.url),
  'utf8',
);
const appState = readFileSync(
  new URL('../../native/src/app_stationhead_state.cpp', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);
const handles = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const policy = readFileSync(
  new URL('../../native/src/sh_track_boundary_message_policy.h', import.meta.url),
  'utf8',
);
const trackScript = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../../../.github/workflows/native-runtime-smoke.yml', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('both windows normally use sakuramankai and buddy46 is the fallback', () => {
  assert.match(
    configHeader,
    /url = L"https:\/\/www\.stationhead\.com\/sakuramankai"/,
  );
  assert.match(
    configHeader,
    /fallbackUrl = L"https:\/\/www\.stationhead\.com\/buddy46"/,
  );
  assert.match(
    configHeader,
    /secondaryUrl = L"https:\/\/www\.stationhead\.com\/sakuramankai"/,
  );
  assert.match(cloudConfig, /kCanonicalPrimaryStationheadUrl/);
  assert.match(cloudConfig, /kCanonicalFallbackStationheadUrl/);
  assert.match(cloudConfig, /kCanonicalSecondaryStationheadUrl/);
  assert.match(
    cloudConfig,
    /config\.stationhead\.fallbackUrl = kCanonicalFallbackStationheadUrl/,
  );
});

test('Window A refreshes at 53 minutes and Window B at 54 minutes', () => {
  const interval = section(
    policy,
    'inline constexpr int64_t StationheadPeriodicRefreshIntervalMs(',
    'static_assert(StationheadPlaybackNavigationActive',
  );
  assert.match(interval, /secondary \? 54 : 53/);
  assert.match(
    policy,
    /static_assert\(StationheadPeriodicRefreshIntervalMs\(false\) == 53 \* 60'000\);/,
  );
  assert.match(
    policy,
    /static_assert\(StationheadPeriodicRefreshIntervalMs\(true\) == 54 \* 60'000\);/,
  );
});

test('the central scheduler uses each role elapsed-time deadline', () => {
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
  const wrapper = section(
    policy,
    '#define RecoverUnavailableAuthorization()',
    '#define RetryPendingTrackBoundaryRefresh',
  );
  assert.match(wrapper, /RecoverUnavailableAuthorizationBase\(\);/);
  assert.match(wrapper, /RefreshPeriodicNavigation\(UnixMillis\(\)\);/);
});

test('each role reloads its current URL with its own reason', () => {
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.match(injected, /StationheadPeriodicRefreshIntervalMs\(IsSecondary\(\)\)/);
  assert.match(injected, /L"54-minute periodic refresh"/);
  assert.match(injected, /L"53-minute periodic refresh"/);
  assert.match(injected, /NavigateCurrentUrl\(/);
  assert.match(injected, /nowMs - periodicRefreshStartedAt_ < intervalMs/);
  assert.doesNotMatch(injected, /ApplyScheduledStationheadAudioProfile|handoff/i);
});

test('navigation restarts only the affected role periodic clock', () => {
  const proxy = section(
    policy,
    'class StationheadNavigationInFlightProxy',
    'class StationheadBoundaryReloadClockProxy',
  );
  assert.match(proxy, /void store\(bool value, std::memory_order order\)/);
  assert.match(
    proxy,
    /if \(value\) \{[\s\S]*refreshStartedAt_ = 0;[\s\S]*navigationObserved_ = 1;/,
  );
  assert.match(
    policy,
    /periodicRefreshNavigationObserved_ != 0 \|\|[\s\S]*!periodicRefreshStartedAt_\.Active\(\)[\s\S]*periodicRefreshStartedAt_ = nowMs;/,
  );
});

test('all two-minute and even-odd clock switching code is removed', () => {
  for (const source of [appHeader, appState, handles, policy, workflow]) {
    assert.doesNotMatch(source, /StationheadClockSwitch|SwitchClockStationDestination/);
    assert.doesNotMatch(source, /clock even-minute|clock odd-minute/);
    assert.doesNotMatch(source, /two-minute|2分/);
  }
  assert.doesNotMatch(appHeader, /kStationheadClockSwitchTimerId/);
  assert.doesNotMatch(appState, /wMinute % 2/);
  assert.doesNotMatch(policy, /kStationheadClockNavigationClickGuardMs/);
  assert.doesNotMatch(workflow, /clock-click-order|clock-switch/);
});

test('track-boundary reload remains disabled', () => {
  assert.match(policy, /#define RetryPendingTrackBoundaryRefresh\(parameters\)/);
  assert.match(policy, /RetryPendingTrackBoundaryRefreshDisabled\(parameters\)/);
  assert.match(policy, /trackBoundaryRefreshPending_ = false;[\s\S]*return false;/);
  const boundaryScript = section(
    trackScript,
    'inline std::wstring StationheadTrackBoundaryScript(const wchar_t*)',
    '}  // namespace hp',
  );
  assert.match(boundaryScript, /return \{\};/);
  assert.match(trackScript, /#define HandleTrackEnded\(\.\.\.\) \(\(void\)0\)/);
  assert.doesNotMatch(boundaryScript, /addEventListener\(['"]ended|postMessage/);
});

test('the existing managed abnormal-state fallback still switches both windows', () => {
  const fallback = section(
    appSource,
    'void App::UpdateStationheadPlaybackFallback(int64_t nowMs)',
    'void App::Tick()',
  );
  assert.match(fallback, /!config_\.stationhead\.fallbackUrl\.empty\(\)/);
  assert.match(fallback, /stationhead_->SetPlaybackFallback\([\s\S]*true/);
  assert.match(fallback, /secondaryStationhead_->SetPlaybackFallback\([\s\S]*true/);
  assert.match(fallback, /returning to primary URL/);
  assert.match(fallback, /returning to secondary URL/);
});
