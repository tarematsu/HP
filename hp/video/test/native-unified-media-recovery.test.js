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
const stationheadEscalation = source('sh_track_boundary_message_policy.h');
const spotify = source('spotify_stagger_schedule.inc');
const spotifyProcesses = source('spotify_process_failure.inc');
const spotifyTrackRecovery = source('spotify_track_start_recovery.h');
const spotifyStartup = source('spotify_startup_audio_recovery.inc');

test('recovery policy has one ordered, cooldown-protected ladder', () => {
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

test('Stationhead escalates confirmed silence without bypassing authentication', () => {
  assert.match(stationhead, /authenticationPending/);
  assert.match(stationhead, /EscalateAudioLossRecovery owns the single shared incident/);
  assert.match(stationheadEscalation, /spotifyAuthorization_ \|\| loginRequired_/);
  assert.match(stationheadEscalation, /audioLossAuthUiDetected_/);
  assert.match(stationheadEscalation, /ObserveMediaRecoveryHealthy/);
  assert.match(
    stationheadEscalation,
    /highestAction !=[\s\S]*MediaRecoveryAction::None[\s\S]*return/,
  );
  assert.match(stationheadEscalation, /MediaRecoveryEvidence::ConfirmedSilence/);
  assert.match(stationheadEscalation, /AttemptNativeStartClick\(nowMs\)/);
  assert.match(stationheadEscalation, /audio-loss recovery reload/);
  assert.match(stationheadEscalation, /rebuilding playback WebView/);
  assert.match(stationheadEscalation, /MediaRecoveryAction::UseFallback/);
  assert.match(stationheadWebView, /MediaPipelineErrorRequiresRebuild/);
  assert.match(stationheadWebView, /ScheduleRecreate\(L"ProcessFailed"/);
});

test('Spotify separates per-track startup recovery from explicit process failures', () => {
  assert.match(spotify, /No periodic IsDocumentPlayingAudio scan here/);
  assert.doesNotMatch(spotify, /MediaRecoveryEvidence::TimelineStall/);
  assert.match(spotifyProcesses, /MediaRecoveryEvidence::NetworkFailure/);
  assert.match(spotifyProcesses, /MediaRecoveryEvidence::ProcessFailure/);
  assert.match(
    spotifyProcesses,
    /MediaRecoveryEvidence::ProcessFailure, now,[\s\S]*slot\.targetGeneration, true, false/,
  );

  assert.match(spotifyStartup, /get_IsDocumentPlayingAudio/);
  assert.match(spotifyStartup, /NextSpotifyTrackStartRecoveryAction/);
  assert.match(spotifyStartup, /SpotifyTrackStartRecoveryAction::ReloadDocument/);
  assert.match(spotifyStartup, /SpotifyTrackStartRecoveryAction::RebuildSurface/);
  assert.match(spotifyStartup, /SpotifyTrackStartRecoveryAction::SkipTrack/);
  assert.match(spotifyStartup, /SkipFailedSpotifyTrack\(slot\)/);
  assert.match(spotifyTrackRecovery, /reloadIssued/);
  assert.match(spotifyTrackRecovery, /rebuildIssued/);
  assert.match(spotifyTrackRecovery, /skipIssued/);
});
