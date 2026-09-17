import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const policy = source('sh_audio_loss_policy.h');
const handleHeader = source('app_stationhead_handles.h');
const handles = source('app_stationhead_handles.cpp');
const playerHeader = source('sh.h');
const audioLoss = source('sh_audio_loss.cpp');
const resolver = source('dashboard_playback_resolve.cpp');
const bridge = source('dashboard_native_playback.cpp');
const appHeader = source('app.h');
const rendererHeader = source('web_renderer.h');
const cmake = readFileSync(new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');

test('audio loss timing boundaries remain fixed', () => {
  assert.match(policy, /kStationheadAudioLossArmStabilityMs = 5'000/);
  assert.match(policy, /kStationheadAudioLossGraceMs = 59'000/);
  assert.match(policy, /kStationheadAudioLossDomSettleMs = 1'000/);
  assert.match(policy, /kStationheadFallbackMinimumDwellMs = 15'000/);
  assert.match(handleHeader,
    /kStationheadTrackTransitionGraceMs =\s*kStationheadAudioLossGraceMs/);
});

test('single handle delegates audio-loss recovery to the player', () => {
  assert.match(handles, /player_->EvaluateAudioLossRecovery\(nowMs\)/);
  assert.doesNotMatch(handles, /SetManagedPlaybackFallback/);
  assert.match(playerHeader, /void EvaluateAudioLossRecovery\(int64_t nowMs\)/);
  assert.match(playerHeader, /void SetManagedPlaybackFallback/);
  assert.match(audioLoss, /void StationheadPlayer::SetManagedPlaybackFallback/);
  assert.match(cmake, /src\/sh_audio_loss\.cpp/);
});

test('startup and navigation audio pulses cannot arm fallback', () => {
  assert.match(audioLoss, /const bool navigationActive/);
  assert.match(audioLoss, /const int64_t playingForMs/);
  assert.match(audioLoss, /StationheadAudioLossCanArm/);
  assert.match(audioLoss, /L"startup_wait"/);
  assert.match(audioLoss, /continuous primary audio confirmed/);
});

test('authentication probe matches live Stationhead controls', () => {
  assert.match(audioLoss, /Connect music/);
  assert.match(audioLoss, /music-service-connect/);
  assert.match(audioLoss, /stationhead-login-form/);
  assert.match(audioLoss, /surface\.querySelectorAll\(actionableSelector\)/);
  assert.match(audioLoss, /getBoundingClientRect/);
  assert.match(audioLoss, /authentication UI probe failed; fallback remains blocked/);
});

test('operation surface is raised before fallback evaluation', () => {
  for (const state of ['transition_wait', 'operation_wait', 'auth_wait', 'fallback',
    'returning_primary', 'playing']) {
    assert.match(audioLoss, new RegExp(`L"${state}"`));
  }
  assert.match(audioLoss, /ShowAfterAudioStop\(\)/);
});

test('navigation time is excluded from recovery failure time', () => {
  assert.match(audioLoss, /Navigation time is not audio-loss time/);
  assert.match(audioLoss, /snapshot\.navigating/);
  assert.match(audioLoss, /snapshot\.processFailed/);
});

test('fallback recovery requires dwell and stable audio', () => {
  assert.match(audioLoss, /StationheadFallbackDwellSatisfied/);
  assert.match(audioLoss, /managedPrimaryReturnPending_/);
  assert.match(audioLoss, /kStationheadPrimaryRecoveryStabilityMs/);
  assert.match(appHeader, /StationheadFallbackRevisionGate/);
  assert.match(appHeader, /startedAt_\.ElapsedMilliseconds\(\) >=\s*kStationheadFallbackMinimumDwellMs/);
});

test('fallback resolver and healthy observation remain active', () => {
  assert.match(resolver, /SelectedStationheadIsOnFallback/);
  assert.match(rendererHeader, /uint64_t healthyRevision = 0/);
  assert.match(resolver, /healthyObservation/);
  assert.match(audioLoss, /feed\.healthyRevision/);
  assert.match(bridge, /kDashboardPollIntervalMs = 5 \* 60'000/);
});
