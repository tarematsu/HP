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
const startupSmoke = readFileSync(
  new URL('../../native/scripts/ci-native-stationhead-startup-smoke.ps1', import.meta.url),
  'utf8',
);
const clickOrderSmoke = readFileSync(
  new URL('../../native/scripts/ci-native-stationhead-clock-click-order.ps1', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('A starts at sakuramankai and B starts at buddy46', () => {
  assert.match(
    configHeader,
    /url = L"https:\/\/www\.stationhead\.com\/sakuramankai"/,
  );
  assert.match(
    configHeader,
    /secondaryUrl = L"https:\/\/www\.stationhead\.com\/buddy46"/,
  );
  assert.match(configHeader, /std::wstring fallbackUrl;/);
  assert.match(cloudConfig, /kCanonicalPrimaryStationheadUrl/);
  assert.match(cloudConfig, /kCanonicalSecondaryStationheadUrl/);
  assert.match(cloudConfig, /config\.stationhead\.fallbackUrl\.clear\(\)/);
  assert.match(cloudConfig, /config\.stationhead\.secondaryEnabled = true/);
});

test('the timer is re-aligned to each wall-clock minute boundary', () => {
  assert.match(appHeader, /kStationheadClockSwitchTimerId = 2/);
  assert.match(appHeader, /StationheadClockSwitchTimerProc/);
  assert.match(appHeader, /stationheadClockSwitchTimerArmed_ = false/);
  assert.match(appState, /kStationheadClockMinuteMs = 60'000/);
  assert.match(appState, /StationheadDelayToNextClockMinute/);
  assert.match(appState, /nowMs % kStationheadClockMinuteMs/);
  assert.match(appState, /KillTimer\(app->window_, kStationheadClockSwitchTimerId\)/);
  assert.match(appState, /app->ArmStationheadClockSwitchTimer\(\)/);
  assert.doesNotMatch(appHeader, /2 \* 60'000/);
});

test('even minutes switch A and odd minutes switch B', () => {
  const handler = section(
    appState,
    'void App::HandleStationheadClockSwitch()',
    'void App::CompleteStationheadClockAudioHandoff(',
  );
  assert.match(handler, /GetLocalTime\(&localTime\)/);
  assert.match(handler, /\(localTime\.wMinute % 2\) == 0/);
  assert.match(handler, /switchPrimary[\s\S]*stationhead_->SwitchClockStationDestination/);
  assert.match(handler, /secondaryStationhead_->SwitchClockStationDestination/);
  assert.match(handler, /stationheadPrimaryUsesBuddy46_/);
  assert.match(handler, /stationheadSecondaryUsesBuddy46_/);
  assert.match(handler, /nextUsesBuddy46 = !usesBuddy46/);
  assert.match(handler, /clock even-minute destination switch/);
  assert.match(handler, /clock odd-minute destination switch/);
});

test('each clock action performs a real background navigation', () => {
  assert.match(handles, /SwitchClockStationDestination/);
  assert.match(policy, /bool SwitchClockStationDestination/);
  assert.match(policy, /NavigateStationheadUrl\(UnixMillis\(\), url, reason, false\)/);
  assert.match(policy, /KeepPlaybackBehindDashboard\(\)/);
  assert.match(policy, /navigationInFlight_\.load/);
  assert.match(policy, /status_\.navigating/);
});

test('outgoing page messages cannot satisfy the post-switch click check', () => {
  assert.match(policy, /kStationheadClockNavigationClickGuardMs = 1'500/);
  assert.match(
    policy,
    /NavigateStationheadUrl\([\s\S]*nextAutoClickAt_ = UnixMillis\(\) \+\s*kStationheadClockNavigationClickGuardMs/,
  );
  assert.match(clickOrderSmoke, /\[int\]\$MinimumDelaySeconds = 1/);
  assert.match(clickOrderSmoke, /navigationPatterns/);
  assert.match(clickOrderSmoke, /clickPatterns/);
  assert.match(clickOrderSmoke, /\$delaySeconds -lt \$MinimumDelaySeconds/);
  assert.match(clickOrderSmoke, /outgoing-document click/);
});

test('the opposite player remains audible until the changed window recovers', () => {
  const handler = section(
    appState,
    'void App::HandleStationheadClockSwitch()',
    'void App::CompleteStationheadClockAudioHandoff(',
  );
  const handoff = section(
    appState,
    'void App::CompleteStationheadClockAudioHandoff(',
    'void App::ToggleStationheadAudio()',
  );
  assert.match(handler, /ApplyScheduledStationheadAudioProfile\(!switchPrimary\)/);
  assert.match(handler, /stationheadClockPendingAudioWindow_ = switchPrimary \? 0 : 1/);
  assert.match(handoff, /primary\.audioPlaying/);
  assert.match(handoff, /secondary->audioPlaying/);
  assert.match(handoff, /ApplyScheduledStationheadAudioProfile\(true\)/);
  assert.match(handoff, /ApplyScheduledStationheadAudioProfile\(false\)/);
});

test('55-minute, 56-minute, and track-boundary navigation are removed', () => {
  assert.doesNotMatch(policy, /55-minute|56-minute|secondary \? 56 : 55/);
  assert.doesNotMatch(policy, /StationheadPeriodicRefreshIntervalMs/);
  assert.doesNotMatch(policy, /RefreshPeriodicNavigation/);
  assert.doesNotMatch(policy, /periodicRefreshStartedAt_/);
  assert.match(policy, /#define RetryPendingTrackBoundaryRefresh\(parameters\)/);
  assert.match(policy, /RetryPendingTrackBoundaryRefreshDisabled\(parameters\)/);
  assert.match(policy, /trackBoundaryRefreshPending_ = false;[\s\S]*return false;/);
  assert.match(
    trackScript,
    /StationheadTrackBoundaryScript\(const wchar_t\*\)[\s\S]*return \{\};/,
  );
  assert.match(trackScript, /#define HandleTrackEnded\(\.\.\.\) \(\(void\)0\)/);
  assert.doesNotMatch(trackScript, /addEventListener\(['"]ended/);
});

test('runtime smoke verifies background Start Listening before and after a clock switch', () => {
  assert.match(startupSmoke, /HomePanelStationheadHost/);
  assert.match(startupSmoke, /HomePanelSecondaryStationheadHost/);
  assert.match(startupSmoke, /HWND_BOTTOM/);
  assert.match(startupSmoke, /primaryClickBehindDashboard/);
  assert.match(startupSmoke, /secondaryClickBehindDashboard/);
  assert.match(startupSmoke, /Stationhead A auto-clicking Start Listening at/);
  assert.match(startupSmoke, /Stationhead B auto-clicking Start Listening at/);
  assert.match(startupSmoke, /clock even-minute destination switch/);
  assert.match(startupSmoke, /clock odd-minute destination switch/);
  assert.match(startupSmoke, /switchedClickBehindDashboard/);
});
