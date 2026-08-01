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

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('A and B are dedicated to sakuramankai and buddy46', () => {
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

test('audio alternation uses a native repeating two-minute timer', () => {
  assert.match(appHeader, /kStationheadAlternationTimerId = 2/);
  assert.match(appHeader, /kStationheadAlternationIntervalMs = 2 \* 60'000/);
  assert.match(appHeader, /StationheadAlternationTimerProc/);
  assert.match(appHeader, /stationheadAlternationTimerArmed_ = false/);

  const timer = section(
    appState,
    'void App::UpdateStationheadAlternationTimer(',
    'void CALLBACK App::StationheadAlternationTimerProc(',
  );
  assert.match(timer, /SetTimer\(/);
  assert.match(timer, /kStationheadAlternationIntervalMs/);
  assert.match(timer, /KillTimer\(/);
  assert.match(timer, /if \(bothPlaying\)/);
});

test('the two-minute callback changes only the native A/B audio profile', () => {
  const callback = section(
    appState,
    'void CALLBACK App::StationheadAlternationTimerProc(',
    'void App::ToggleStationheadAudio()',
  );
  assert.match(callback, /stationhead_\.AudioPlaying\(\)/);
  assert.match(callback, /secondaryStationhead_\.AudioPlaying\(\)/);
  assert.match(
    callback,
    /scheduledPrimaryAudioAudible_ =\s*!app->scheduledPrimaryAudioAudible_/,
  );
  assert.match(callback, /ApplyScheduledStationheadAudioProfile/);
  assert.doesNotMatch(callback, /stationheadAudioMuted_\s*=/);
  assert.doesNotMatch(callback, /Navigate|Reload|SetPlaybackFallback/);
});

test('55-minute, 56-minute, and track-boundary navigation are removed', () => {
  assert.doesNotMatch(policy, /55-minute|56-minute|secondary \? 56 : 55/);
  assert.doesNotMatch(policy, /StationheadPeriodicRefreshIntervalMs/);
  assert.doesNotMatch(policy, /RefreshPeriodicNavigation/);
  assert.doesNotMatch(policy, /periodicRefreshStartedAt_/);
  assert.match(
    trackScript,
    /StationheadTrackBoundaryScript\(const wchar_t\*\)[\s\S]*return \{\};/,
  );
  assert.match(trackScript, /#define HandleTrackEnded\(\.\.\.\) \(\(void\)0\)/);
  assert.doesNotMatch(trackScript, /addEventListener\(['"]ended/);
});

test('runtime smoke verifies Start Listening while both WebViews are behind the dashboard', () => {
  assert.match(startupSmoke, /HomePanelStationheadHost/);
  assert.match(startupSmoke, /HomePanelSecondaryStationheadHost/);
  assert.match(startupSmoke, /HWND_BOTTOM/);
  assert.match(startupSmoke, /width=1|0, 0, 1, 1/);
  assert.match(startupSmoke, /primaryClickBehindDashboard/);
  assert.match(startupSmoke, /secondaryClickBehindDashboard/);
  assert.match(startupSmoke, /Stationhead A auto-clicking Start Listening at/);
  assert.match(startupSmoke, /Stationhead B auto-clicking Start Listening at/);
  assert.match(startupSmoke, /stationhead\.com\/sakuramankai/);
  assert.match(startupSmoke, /stationhead\.com\/buddy46/);
});
