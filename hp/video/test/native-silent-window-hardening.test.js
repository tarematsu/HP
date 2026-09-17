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
const stationheadLifecycle = source('sh_runtime_lifecycle_script.h');
const recoveryCoordinator = source('media_recovery_coordinator.h');

test('media WebViews disable Chromium background throttling', () => {
  assert.match(environment, /--disable-backgrounding-occluded-windows/);
  assert.match(environment, /--disable-renderer-backgrounding/);
  assert.match(environment, /--disable-background-timer-throttling/);
});

test('Spotify has an event-independent media progression watchdog', () => {
  assert.match(spotifyEvents, /progressProbeMs = 4000/);
  assert.match(spotifyEvents, /progressStallMs = 12000/);
  assert.match(spotifyEvents, /const probeProgress = \(\) =>/);
  assert.match(spotifyEvents, /current > progressTime \+ 0\.10/);
  assert.match(spotifyEvents, /keyWaitingMedia === media/);
  assert.match(spotifyEvents, /post\('spotify:timed-interrupted'\)/);
});

test('Stationhead re-kicks a frozen media clock then enters native DRM recovery', () => {
  assert.match(stationheadLifecycle, /progressProbeMs = 4000/);
  assert.match(stationheadLifecycle, /progressStallMs = 12000/);
  assert.match(stationheadLifecycle, /const probeMediaProgress = \(\) =>/);
  assert.match(stationheadLifecycle, /media\.pause\(\)/);
  assert.match(stationheadLifecycle, /media\.play\?\.\(\)/);
  assert.match(stationheadLifecycle, /progressSyntheticKeyWait = true/);
  assert.match(stationheadLifecycle, /postText\('drm-waiting'\)/);
  assert.match(stationheadLifecycle, /postText\('drm-ready'\)/);
  assert.doesNotMatch(stationheadLifecycle, /location\.reload\(\)/);
  assert.match(stationheadLifecycle, /keyWaitingMedia === media/);
});

test('Stationhead and Spotify share one bounded recovery episode', () => {
  assert.match(recoveryCoordinator, /enum class MediaRecoveryAction/);
  assert.match(recoveryCoordinator, /ReassertPlayback = 1/);
  assert.match(recoveryCoordinator, /ReloadDocument = 2/);
  assert.match(recoveryCoordinator, /RebuildSurface = 3/);
  assert.match(recoveryCoordinator, /UseFallback = 4/);
  assert.match(recoveryCoordinator, /kMediaRecoveryHealthyResetMs = 30ULL \* 1000ULL/);
  assert.match(recoveryCoordinator, /static_assert\(MediaRecoveryCoordinatorContract\(\)\)/);
  assert.match(spotifyScheduler, /NextMediaRecoveryAction\(/);
  assert.match(spotifyScheduler, /MediaRecoveryEvidence::ConfirmedSilence/);
  assert.match(spotifyScheduler, /MediaRecoveryAction::ReloadDocument/);
  assert.match(spotifyScheduler, /MediaRecoveryAction::RebuildSurface/);
});
