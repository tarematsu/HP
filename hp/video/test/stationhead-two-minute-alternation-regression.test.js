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

test('audio alternation uses a two-minute monotonic deadline', () => {
  assert.match(policy, /kStationheadAlternationIntervalMs = 2 \* 60'000/);
  assert.match(policy, /static_assert\(kStationheadAlternationIntervalMs == 120'000\)/);
  const observation = section(
    policy,
    'inline StationheadAlternationAction ObserveStationheadAlternation(',
    'inline int64_t StationheadAlternationNextWakeAt',
  );
  assert.match(observation, /const ULONGLONG now = GetTickCount64\(\)/);
  assert.match(observation, /primaryPlaying &&[\s\S]*secondaryPlaying/);
  assert.match(observation, /if \(!bothPlaying\) \{[\s\S]*nextSwitchAt = 0/);
  assert.match(
    observation,
    /nextSwitchAt =\s*now \+ static_cast<ULONGLONG>\(kStationheadAlternationIntervalMs\)/,
  );
});

test('only the native A/B mute profile changes at the deadline', () => {
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.match(injected, /ObserveStationheadAlternation/);
  assert.match(injected, /kStationheadAudioToggleAction/);
  assert.match(injected, /PostMessageW/);
  assert.match(injected, /action\.preserveMute/);
  assert.match(injected, /kStationheadAudioMuteAction/);
  assert.doesNotMatch(injected, /Navigate|Reload|refresh URL|periodic refresh/);
});

test('the scheduler wakes at the shared two-minute switch deadline', () => {
  const wake = section(policy, '#define NextWakeAt()', '#define RecoverUnavailableAuthorization()');
  assert.match(wake, /NextWakeAtBase\(\)/);
  assert.match(wake, /StationheadAlternationNextWakeAt\(IsSecondary\(\)\)/);
  assert.doesNotMatch(wake, /55|56|PeriodicRefresh/);
});

test('55-minute, 56-minute, and track-boundary navigation are disabled', () => {
  assert.doesNotMatch(policy, /55-minute|56-minute|secondary \? 56 : 55/);
  assert.doesNotMatch(policy, /RefreshPeriodicNavigation|periodicRefreshStartedAt_/);
  assert.match(policy, /trackBoundaryRefreshPending_ = false/);
  assert.match(policy, /RetryPendingTrackBoundaryRefreshDisabled/);
  assert.match(
    trackScript,
    /StationheadTrackBoundaryScript\(const wchar_t\*\)[\s\S]*return \{\};/,
  );
  assert.match(trackScript, /#define HandleTrackEnded\(\.\.\.\) \(\(void\)0\)/);
  assert.doesNotMatch(trackScript, /55 minutes|56 minutes|addEventListener\(['"]ended/);
});
