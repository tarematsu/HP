import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const coordinator = source('media_recovery_coordinator.h');
const stationhead = source('sh_audio_loss.cpp');
const stationheadWebView = source('sh_webview.cpp');
const stationheadRecovery = source('sh_track_boundary_message_policy.h');

test('shared recovery coordinator remains bounded for explicit media failures', () => {
  assert.match(coordinator, /kMediaRecoveryIncidentWindowMs/);
  assert.match(coordinator, /kMediaRecoveryActionCooldownMs/);
  assert.match(coordinator, /kMediaRecoveryHealthyResetMs/);
  assert.match(coordinator, /highestActionAttempts >= 2/);
  assert.match(coordinator, /MediaRecoveryWithoutFallbackContract/);
  assert.match(coordinator, /MediaRecoveryTimelineStallContract/);
  assert.match(coordinator, /requested.*ReassertPlayback/s);
  assert.match(coordinator, /highestAction.*ReloadDocument/s);
  assert.match(coordinator, /highestAction.*RebuildSurface/s);
  assert.match(coordinator, /fallbackAvailable.*UseFallback/s);
});

test('Stationhead uses one explicit silence ladder and checks auth before destructive steps', () => {
  assert.match(stationhead, /authenticationPending/);
  assert.match(stationheadRecovery, /spotifyAuthorization_ \|\| loginRequired_/);
  assert.match(stationheadRecovery, /audioLossAuthUiDetected_/);
  assert.match(stationheadRecovery, /StationheadAudioRecoveryStage/);
  assert.match(stationheadRecovery, /RecoveryStage::LightRepair/);
  assert.match(stationheadRecovery, /AttemptNativeStartClick\(nowMs\)/);
  assert.match(stationheadRecovery, /audio-loss recovery reload/);
  assert.match(stationheadRecovery, /Stationhead silence recovery WebView rebuild/);
  assert.match(stationheadRecovery, /RecoveryStage::Fallback/);
  assert.match(stationheadRecovery, /BeginAudioLossAuthProbe\(nowMs\)/);
  assert.match(stationheadRecovery, /SetManagedPlaybackFallback/);
  assert.doesNotMatch(stationheadRecovery, /NextMediaRecoveryAction/);
  assert.doesNotMatch(stationheadRecovery, /MediaRecoveryEvidence::ConfirmedSilence/);

  assert.match(stationheadWebView, /MediaPipelineErrorRequiresRebuild/);
  assert.match(stationheadWebView, /ScheduleRecreate\(L"ProcessFailed"/);
});

