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

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('both windows start at sakuramankai and buddy46 is the rotation source', () => {
  assert.match(
    configHeader,
    /url = L"https:\/\/www\.stationhead\.com\/sakuramankai"/,
  );
  assert.match(
    configHeader,
    /alternateUrl = L"https:\/\/www\.stationhead\.com\/buddy46"/,
  );
  assert.match(
    configHeader,
    /secondaryUrl = L"https:\/\/www\.stationhead\.com\/sakuramankai"/,
  );
  assert.match(configHeader, /std::wstring fallbackUrl;/);
  assert.match(cloudConfig, /kCanonicalPrimaryStationheadUrl/);
  assert.match(cloudConfig, /kCanonicalAlternateStationheadUrl/);
  assert.match(
    cloudConfig,
    /config\.stationhead\.alternateUrl = kCanonicalAlternateStationheadUrl/,
  );
  assert.match(cloudConfig, /config\.stationhead\.fallbackUrl\.clear\(\)/);
  assert.match(cloudConfig, /config\.stationhead\.secondaryEnabled = true/);
});

test('the timer aligns to every wall-clock :00 and :30 boundary', () => {
  assert.match(appHeader, /kStationheadClockSwitchTimerId = 2/);
  assert.match(appHeader, /StationheadClockSwitchTimerProc/);
  assert.match(appHeader, /stationheadClockSwitchTimerArmed_ = false/);
  assert.match(appState, /kStationheadClockSlotMs = 30'000/);
  assert.match(appState, /StationheadDelayToNextClockSlot/);
  assert.match(appState, /nowMs % kStationheadClockSlotMs/);
  assert.match(appState, /KillTimer\(app->window_, kStationheadClockSwitchTimerId\)/);
  assert.match(appState, /app->ArmStationheadClockSwitchTimer\(\)/);
  assert.doesNotMatch(appHeader, /2 \* 60'000/);
});

test('minute :00 switches A and minute :30 switches B', () => {
  const handler = section(
    appState,
    'void App::HandleStationheadClockSwitch()',
    'void App::CompleteStationheadClockAudioHandoff(',
  );
  assert.match(handler, /clockSlot = nowMs \/ kStationheadClockSlotMs/);
  assert.match(handler, /\(clockSlot % 2\) == 0/);
  assert.match(handler, /switchPrimary[\s\S]*stationhead_->SwitchClockStationDestination/);
  assert.match(handler, /secondaryStationhead_->SwitchClockStationDestination/);
  assert.match(handler, /stationheadPrimaryUsesBuddy46_/);
  assert.match(handler, /stationheadSecondaryUsesBuddy46_/);
  assert.match(handler, /nextUsesBuddy46 = !usesBuddy46/);
  assert.match(handler, /clock minute-zero destination switch/);
  assert.match(handler, /clock minute-thirty destination switch/);
  assert.match(handler, /Stationhead clock :00 switched A/);
  assert.match(handler, /Stationhead clock :30 switched B/);
});

test('each window alternates independently between both stations', () => {
  assert.match(appHeader, /stationheadPrimaryUsesBuddy46_ = false/);
  assert.match(appHeader, /stationheadSecondaryUsesBuddy46_ = false/);
  const handler = section(
    appState,
    'void App::HandleStationheadClockSwitch()',
    'void App::CompleteStationheadClockAudioHandoff(',
  );
  assert.match(handler, /nextUsesBuddy46 = !usesBuddy46/);
  assert.match(
    handler,
    /nextUsesBuddy46[\s\S]*config_\.stationhead\.alternateUrl[\s\S]*config_\.stationhead\.url/,
  );
  assert.match(handler, /usesBuddy46 = nextUsesBuddy46/);
});

test('each clock action performs a real background navigation', () => {
  assert.match(handles, /SwitchClockStationDestination/);
  assert.match(policy, /bool SwitchClockStationDestination/);
  assert.match(policy, /navigationInFlight_\.store\(true, std::memory_order_release\)/);
  assert.match(policy, /NavigateStationheadUrl\(UnixMillis\(\), url, reason, false\)/);
  assert.match(policy, /KeepPlaybackBehindDashboard\(\)/);
  assert.match(policy, /navigationInFlight_\.load/);
  assert.match(policy, /status_\.navigating/);
});

test('outgoing page messages cannot satisfy post-switch playback recovery', () => {
  assert.match(policy, /kStationheadClockNavigationClickGuardMs = 1'500/);
  assert.match(
    policy,
    /NavigateStationheadUrl\([\s\S]*nextAutoClickAt_ = UnixMillis\(\) \+ kStationheadClockNavigationClickGuardMs/,
  );
  assert.match(appState, /kStationheadClockFreshAudioDelayMs = 1'000/);
  assert.match(appState, /audioPlayingSince >=[\s\S]*switchStartedAt \+/);
});

test('the opposite player remains audible until navigation and playback recover', () => {
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
  assert.match(handles, /ClockStationNavigationSettled/);
  assert.match(policy, /ClockStationNavigationSettled\(\) const noexcept/);
  assert.match(handoff, /primary\.audioPlaying[\s\S]*stationhead_->ClockStationNavigationSettled\(\)/);
  assert.match(handoff, /secondary->audioPlaying[\s\S]*secondaryStationhead_->ClockStationNavigationSettled\(\)/);
  assert.match(handoff, /ApplyScheduledStationheadAudioProfile\(true\)/);
  assert.match(handoff, /ApplyScheduledStationheadAudioProfile\(false\)/);
});

test('55-minute, 54-minute, and track-boundary navigation are removed', () => {
  assert.doesNotMatch(policy, /54-minute|55-minute/);
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
  assert.doesNotMatch(trackScript, /addEventListener\(['"]ended|postMessage/);
});
