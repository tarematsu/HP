import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const environment = source('shared_webview_environment.cpp');
const spotifyEvents = source('spotify_media_observer_events.inc');
const spotifyScheduler = source('spotify_stagger_schedule.inc');
const spotifyTrackRecovery = source('spotify_track_start_recovery.h');
const spotifyStartupAudio = source('spotify_startup_audio_recovery.inc');
const stationheadLifecycle = source('sh_runtime_lifecycle_script.h');
const recoveryCoordinator = source('media_recovery_coordinator.h');

test('media WebViews keep background timers active without forcing renderer foreground scheduling', () => {
  assert.doesNotMatch(environment, /--disable-backgrounding-occluded-windows/);
  assert.doesNotMatch(environment, /--disable-renderer-backgrounding/);
  assert.match(environment, /--disable-background-timer-throttling/);
});

test('Spotify has an adaptive event-independent media progression watchdog', () => {
  assert.match(spotifyEvents, /progressProbeMs = 4000/);
  assert.match(spotifyEvents, /progressHealthyProbeMs = 8000/);
  assert.match(spotifyEvents, /progressStallMs = 12000/);
  assert.match(spotifyEvents, /const probeProgress = \(\) =>/);
  assert.match(spotifyEvents, /current > progressTime \+ 0\.10/);
  assert.match(spotifyEvents, /progressConfirmed = true/);
  assert.match(spotifyEvents, /healthyProgress \? progressHealthyProbeMs : progressProbeMs/);
  assert.match(spotifyEvents, /keyWaitingMedia === media/);
  assert.match(spotifyEvents, /post\('spotify:timed-interrupted'\)/);
});

test('Stationhead backs off healthy probes but keeps fast frozen-media recovery', () => {
  assert.match(stationheadLifecycle, /progressProbeMs = 4000/);
  assert.match(stationheadLifecycle, /progressHealthyProbeMs = 8000/);
  assert.match(stationheadLifecycle, /recoverableHealthyProbeMs = 16000/);
  assert.match(stationheadLifecycle, /progressStallMs = 12000/);
  assert.match(stationheadLifecycle, /const probeMediaProgress = \(\) =>/);
  assert.match(stationheadLifecycle, /progressConfirmed = true/);
  assert.match(stationheadLifecycle, /healthyProgress \? progressHealthyProbeMs : progressProbeMs/);
  assert.match(stationheadLifecycle, /fastRecoverableProbe/);
  assert.match(stationheadLifecycle, /probeStartedAt - lastRecoverableProbeAt >= recoverableHealthyProbeMs/);
  assert.match(stationheadLifecycle, /publishRecoverableOnboarding\(\)/);
  assert.match(stationheadLifecycle, /media\.pause\(\)/);
  assert.match(stationheadLifecycle, /media\.play\?\.\(\)/);
  assert.match(stationheadLifecycle, /progressSyntheticKeyWait = true/);
  assert.match(stationheadLifecycle, /postText\('drm-waiting'\)/);
  assert.match(stationheadLifecycle, /postText\('drm-ready'\)/);
  assert.doesNotMatch(stationheadLifecycle, /location\.reload\(\)/);
  assert.match(stationheadLifecycle, /keyWaitingMedia === media/);
});

test('Stationhead caches active media during healthy playback instead of scanning the DOM every probe', () => {
  assert.match(stationheadLifecycle, /let progressCandidateMedia = null/);
  assert.match(stationheadLifecycle, /const activeProgressMedia = media =>/);
  assert.match(stationheadLifecycle, /const rememberProgressMedia = event =>/);
  assert.match(stationheadLifecycle, /const currentProgressMedia = \(\) =>/);
  assert.match(stationheadLifecycle, /activeProgressMedia\(progressCandidateMedia\)/);
  assert.match(stationheadLifecycle, /progressCandidateMedia = media/);
  assert.match(stationheadLifecycle, /document\.querySelectorAll\('audio,video'\)/);
  assert.match(stationheadLifecycle, /document\.addEventListener\(eventName, onMediaStateEvent, true\)/);
});

test('Stationhead and Spotify keep bounded recovery in their distinct roles', () => {
  assert.match(recoveryCoordinator, /enum class MediaRecoveryAction/);
  assert.match(recoveryCoordinator, /ReassertPlayback = 1/);
  assert.match(recoveryCoordinator, /ReloadDocument = 2/);
  assert.match(recoveryCoordinator, /RebuildSurface = 3/);
  assert.match(recoveryCoordinator, /UseFallback = 4/);
  assert.match(recoveryCoordinator, /kMediaRecoveryHealthyResetMs = 30ULL \* 1000ULL/);
  assert.match(recoveryCoordinator, /static_assert\(MediaRecoveryCoordinatorContract\(\)\)/);

  assert.match(spotifyTrackRecovery, /struct SpotifyTrackStartRecovery/);
  assert.match(spotifyTrackRecovery, /reloadIssued/);
  assert.match(spotifyTrackRecovery, /ConsumeSpotifyStartupReload/);
  assert.doesNotMatch(spotifyTrackRecovery, /RebuildSurface|rebuildIssued|skipIssued/);
  assert.match(spotifyStartupAudio, /ConsumeSpotifyStartupReload/);
  assert.match(spotifyStartupAudio, /slot\.webview->Reload\(\)/);
  assert.match(spotifyStartupAudio, /SkipFailedSpotifyTrack\(slot\)/);
  assert.doesNotMatch(spotifyStartupAudio, /RebuildSurface|mediaPipelineRecoveryPending = true/);
  assert.doesNotMatch(spotifyScheduler, /kSpotifyAudioHealthCheckMs|MediaRecoveryEvidence::TimelineStall/);
});
