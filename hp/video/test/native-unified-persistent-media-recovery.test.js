import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const coordinator = source('media_recovery_coordinator.h');
const sharedHeader = source('shared_webview_environment.h');
const shared = source('shared_webview_environment.cpp');
const spotifyHeader = source('spotify_webviews.h');
const schedule = source('spotify_stagger_schedule.inc');
const click = source('spotify_background_click.inc');
const startup = source('spotify_startup_audio_recovery.inc');
const processFailure = source('spotify_process_failure.inc');
const controller = source('spotify_controller_lifecycle.inc');

test('Spotify steady state no longer uses the persistent silence-recovery ladder', () => {
  assert.doesNotMatch(schedule, /MediaRecoveryAction::RepairPlaybackState/);
  assert.doesNotMatch(schedule, /MediaRecoveryAction::DeepRepairPlaybackState/);
  assert.doesNotMatch(schedule, /MediaRecoveryAction::RecycleEnvironment/);
  assert.doesNotMatch(schedule, /ClearBrowsingData/);
  assert.doesNotMatch(schedule, /RecycleBrowserProcess/);
  assert.doesNotMatch(schedule, /profileRecovery/);
  assert.doesNotMatch(spotifyHeader, /profileRecovery/);
  assert.doesNotMatch(spotifyHeader, /extendedRecoveryBlockedUntilTick/);
  assert.match(schedule, /No periodic IsDocumentPlayingAudio scan here/);
});

test('Spotify normal destructive recovery is scoped to one target generation and terminates with skip', () => {
  assert.match(spotifyHeader, /SpotifyTrackStartRecovery trackStartRecovery/);
  assert.match(click, /EscalateSpotifyStartupFailure\(/);
  assert.match(startup, /slot\.trackStartRecovery, slot\.targetGeneration/);
  assert.match(startup, /SpotifyTrackStartRecoveryAction::ReloadDocument/);
  assert.match(startup, /SpotifyTrackStartRecoveryAction::RebuildSurface/);
  assert.match(startup, /SpotifyTrackStartRecoveryAction::SkipTrack/);
  assert.match(startup, /SkipFailedSpotifyTrack\(slot\)/);
  assert.doesNotMatch(
    click,
    /NextMediaRecoveryAction\([\s\S]*MediaRecoveryEvidence::ConfirmedSilence/,
  );
});

test('explicit Spotify process and media-pipeline failures remain event driven', () => {
  assert.match(processFailure, /add_ProcessFailed/);
  assert.match(processFailure, /MediaRecoveryEvidence::ProcessFailure/);
  assert.match(processFailure, /MediaRecoveryEvidence::NetworkFailure/);
  assert.match(controller, /SubscribeMediaPipelineErrors/);
  assert.match(controller, /MediaRecoveryEvidence::FatalPipeline/);
  assert.match(controller, /MediaRecoveryEvidence::NetworkFailure/);
});

test('heavy Spotify surface recovery remains serialized', () => {
  assert.match(schedule, /kSpotifyHeavyRecoverySpacingMs = 5ULL \* 1000ULL/);
  assert.match(schedule, /gSpotifyHeavyRecoveryNextTick/);
  assert.match(schedule, /slot\.nextRecoveryTick = std::max/);
  assert.match(schedule, /RebuildPlaybackSurface\(slot\)/);
});

test('shared browser recycle helper stays bounded but is not a Spotify steady-state action', () => {
  assert.match(sharedHeader, /RecycleBrowserProcess/);
  assert.match(shared, /ICoreWebView2Environment5/);
  assert.match(shared, /add_BrowserProcessExited/);
  assert.match(shared, /HRESULT_FROM_WIN32\(ERROR_RETRY\)/);
  assert.match(shared, /kSharedBrowserRecycleCooldownMs = 10ULL \* 60ULL \* 1000ULL/);
  assert.match(shared, /TerminateProcess\(process, kSharedBrowserRecycleExitCode\)/);
  assert.doesNotMatch(schedule, /RecycleBrowserProcess/);
  assert.match(coordinator, /MediaRecoveryExtendedRecoveryContract/);
});
