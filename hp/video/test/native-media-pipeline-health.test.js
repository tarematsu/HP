import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url), 'utf8');

const health = source('media_pipeline_health.h');
const stationhead = source('sh_webview.cpp');
const spotifyController = source('spotify_controller_lifecycle.inc');
const spotifyScheduler = source('spotify_stagger_schedule.inc');

test('Chromium media errors are subscribed independently of WebView mute state', () => {
  assert.match(health, /Media\.playerErrorsRaised/);
  assert.match(health, /Media\.enable/);
  assert.doesNotMatch(health, /get_IsMuted/);
  assert.doesNotMatch(health, /put_IsMuted/);
});

test('Stationhead rebuilds its playback WebView on decoder pipeline failure', () => {
  assert.match(stationhead, /SubscribeMediaPipelineErrors/);
  assert.match(stationhead, /Chromium Media\.playerErrorsRaised/);
  assert.match(stationhead, /ScheduleRecreate\([\s\S]*Chromium media decode\/pipeline failure/);
  assert.match(stationhead, /UnsubscribeMediaPipelineErrors/);
  assert.match(stationhead, /mediaErrorRecoveryLifecycle_\.lock\(\) == createCallbackAlive_/);
});

test('Spotify defers decoder recovery and rebuilds only the affected surface', () => {
  assert.match(spotifyController, /SubscribeMediaPipelineErrors/);
  assert.match(spotifyController, /mediaPipelineRecoveryPending = true/);
  assert.match(spotifyController, /mediaPipelineRecoveryGeneration ==[\s\S]*targetGeneration/);
  assert.match(spotifyController, /void SpotifyWebViews::RebuildPlaybackSurface/);
  assert.match(spotifyScheduler, /if \(!slot\.mediaPipelineRecoveryPending\) continue/);
  assert.match(spotifyScheduler, /RebuildPlaybackSurface\(slot\)/);
});

test('Spotify decoder rebuild preserves target generation and rotation', () => {
  const start = spotifyController.indexOf(
    'void SpotifyWebViews::RebuildPlaybackSurface');
  const end = spotifyController.indexOf(
    'void SpotifyWebViews::CreateController', start);
  assert.ok(start >= 0 && end > start);
  const rebuild = spotifyController.slice(start, end);
  assert.doesNotMatch(rebuild, /targetGeneration = 0/);
  assert.doesNotMatch(rebuild, /timedRotationPosition = 0/);
  assert.match(rebuild, /SetSlotState\(slot, SlotState::NotCreated\)/);
});
