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

test('Stationhead re-kicks and reloads a media element whose clock freezes silently', () => {
  assert.match(stationheadLifecycle, /progressProbeMs = 4000/);
  assert.match(stationheadLifecycle, /progressStallMs = 12000/);
  assert.match(stationheadLifecycle, /const probeMediaProgress = \(\) =>/);
  assert.match(stationheadLifecycle, /media\.pause\(\)/);
  assert.match(stationheadLifecycle, /media\.play\?\.\(\)/);
  assert.match(stationheadLifecycle, /location\.reload\(\)/);
  assert.match(stationheadLifecycle, /keyWaitingMedia === media/);
});

test('repeated Spotify native silence escalates to a fresh playback surface', () => {
  assert.match(spotifyScheduler, /kSpotifyDeadSinkStrikeWindowMs = 2ULL \* 60ULL \* 1000ULL/);
  assert.match(spotifyScheduler, /gSpotifyDeadSinkStrikeCounts/);
  assert.match(spotifyScheduler, /strikeGeneration != slot\.targetGeneration/);
  assert.match(spotifyScheduler, /if \(strikes >= 2\)/);
  assert.match(spotifyScheduler, /slot\.mediaPipelineRecoveryPending = true/);
  assert.match(spotifyScheduler, /SetSlotState\(slot, SlotState::Recovering\)/);
});
