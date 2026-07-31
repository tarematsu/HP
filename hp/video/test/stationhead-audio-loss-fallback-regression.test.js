import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_audio_loss_policy.h', import.meta.url),
  'utf8',
);
const handlesHeader = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const handlesSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);
const playerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const audioLossSource = readFileSync(
  new URL('../../native/src/sh_audio_loss.cpp', import.meta.url),
  'utf8',
);
const playbackResolver = readFileSync(
  new URL('../../native/src/dashboard_playback_resolve.cpp', import.meta.url),
  'utf8',
);
const playbackBridge = readFileSync(
  new URL('../../native/src/dashboard_native_playback.cpp', import.meta.url),
  'utf8',
);
const appHeader = readFileSync(
  new URL('../../native/src/app.h', import.meta.url),
  'utf8',
);
const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);

test('audio loss policy fixes the requested timing boundaries', () => {
  assert.match(policy, /kStationheadAudioLossGraceMs = 10'000/);
  assert.match(policy, /kStationheadAudioLossProbeSettleMs = 1'000/);
  assert.match(policy, /kStationheadFallbackMinimumDwellMs = 15'000/);
  assert.match(policy, /kStationheadPrimaryRecoveryStabilityMs = 2'000/);
  assert.match(
    handlesHeader,
    /kStationheadTrackTransitionGraceMs =\s*kStationheadAudioLossGraceMs/,
  );
});

test('each Stationhead player evaluates audio loss and uses managed fallback', () => {
  assert.match(handlesSource, /player_->EvaluateAudioLossRecovery\(nowMs\)/);
  assert.match(
    handlesSource,
    /player_->SetManagedPlaybackFallback\(active, reason\)/,
  );
  assert.match(playerHeader, /void EvaluateAudioLossRecovery\(int64_t nowMs\)/);
  assert.match(playerHeader, /void SetManagedPlaybackFallback/);
  assert.match(cmake, /src\/sh_audio_loss\.cpp/);
});

test('authentication probing is limited to visible actionable UI', () => {
  assert.match(audioLossSource, /getBoundingClientRect/);
  assert.match(audioLossSource, /style\.display !== 'none'/);
  assert.match(audioLossSource, /log\\s\*in\|sign\\s\*in\|login/);
  assert.match(audioLossSource, /connect\|continue\|authorize/);
  assert.match(audioLossSource, /spotifyAuthentication/);
  assert.match(audioLossSource, /authentication UI probe failed; fallback remains blocked/);
  assert.match(audioLossSource, /snapshot\.navigating/);
  assert.match(audioLossSource, /snapshot\.processFailed/);
});

test('fallback recovery waits for dwell and stable primary audio', () => {
  assert.match(audioLossSource, /StationheadFallbackDwellSatisfied/);
  assert.match(audioLossSource, /managedPlaybackReturnRequested_/);
  assert.match(audioLossSource, /managedPrimaryReturnPending_/);
  assert.match(
    audioLossSource,
    /nowMs - playingSince >= kStationheadPrimaryRecoveryStabilityMs/,
  );
  assert.match(appHeader, /StationheadFallbackRevisionGate/);
  assert.match(
    appHeader,
    /startedAt_\.ElapsedMilliseconds\(\) >=\s*kStationheadFallbackMinimumDwellMs/,
  );
});

test('only a newer healthy five-minute playback observation releases fallback', () => {
  assert.match(playbackResolver, /healthyObservation/);
  assert.match(playbackResolver, /!projection\.stale/);
  assert.match(playbackResolver, /!projection\.setupRequired/);
  assert.match(playbackResolver, /static_cast<uint64_t>\(projection\.fetchedAt\)/);
  assert.match(
    audioLossSource,
    /waiting for a newer healthy five-minute playback observation/,
  );
  assert.match(
    playbackBridge,
    /kDashboardPollIntervalMs = 5 \* 60'000/,
  );
  assert.doesNotMatch(audioLossSource, /kDashboardPollIntervalMs/);
});
