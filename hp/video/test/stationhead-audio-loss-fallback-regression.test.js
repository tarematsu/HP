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
const rendererHeader = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url),
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
  assert.match(policy, /kStationheadAudioLossGraceMs = 11'000/);
  assert.match(policy, /kStationheadAudioLossProbeRetryMs = 1'000/);
  assert.doesNotMatch(policy, /ProbeSettle/);
  assert.match(policy, /kStationheadFallbackMinimumDwellMs = 15'000/);
  assert.match(policy, /kStationheadPrimaryRecoveryStabilityMs = 2'000/);
  assert.match(
    handlesHeader,
    /kStationheadTrackTransitionGraceMs =\s*kStationheadAudioLossGraceMs/,
  );
  assert.match(policy, /StationheadAudioLossCanFallback\(true, false, 11'000\)/);
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

test('authentication probing matches the live Stationhead DOM structure', () => {
  assert.match(audioLossSource, /Connect music/);
  assert.match(audioLossSource, /music-service-connect/);
  assert.match(audioLossSource, /stationhead-login-form/);
  assert.match(audioLossSource, /stationhead-login-control/);
  assert.match(audioLossSource, /surface\.querySelectorAll\(actionableSelector\)/);
  assert.match(audioLossSource, /\bspotify\b/);
  assert.match(audioLossSource, /\bapple\\s\+music\b/);
  assert.match(audioLossSource, /element\.checkVisibility/);
  assert.match(audioLossSource, /getBoundingClientRect/);
  assert.match(audioLossSource, /authentication UI probe failed; fallback remains blocked/);
  assert.match(audioLossSource, /audioLossProbeComplete_ = !authentication/);
  assert.match(audioLossSource, /audioLossStartedAt_\.WallTime\(\) != lossStartedAt/);
});

test('the operation surface is raised once before fallback evaluation', () => {
  assert.match(audioLossSource, /audioLossState_ == L"transition_wait"/);
  assert.match(audioLossSource, /ShowAfterAudioStop\(\)/);
  assert.match(audioLossSource, /L"operation_wait"/);
  assert.match(audioLossSource, /L"auth_wait"/);
  assert.match(audioLossSource, /L"fallback"/);
  assert.match(audioLossSource, /L"returning_primary"/);
  assert.match(audioLossSource, /L"playing"/);
});

test('navigation time is excluded from the recovery failure interval', () => {
  assert.match(audioLossSource, /audioLossStartedAt_ = 0;\n\s*ResetAudioLossProbe\(\);\n\s*return;/);
  assert.match(audioLossSource, /Navigation time is not audio-loss time/);
  assert.match(audioLossSource, /audioLossPlaybackObserved_ = true;\n\s*audioLossStartedAt_ = 0/);
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
  assert.match(rendererHeader, /uint64_t healthyRevision = 0/);
  assert.match(playbackResolver, /healthyObservation/);
  assert.match(playbackResolver, /!projection\.stale/);
  assert.match(playbackResolver, /!projection\.setupRequired/);
  assert.match(playbackResolver, /status\.healthyRevision = healthyObservation/);
  assert.match(audioLossSource, /feed\.healthyRevision/);
  assert.match(appHeader, /candidateRevision >= 100'000'000'000ULL/);
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