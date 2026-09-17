import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url), 'utf8');

const health = source('media_pipeline_health.h');
const stationhead = source('sh_webview.cpp');
const stationheadLifecycle = source('sh_runtime_lifecycle_script.h');
const stationheadTick = source('sh.cpp');
const spotifyController = source('spotify_controller_lifecycle.inc');
const spotifyEvents = source('spotify_media_observer_events.inc');
const spotifyScheduler = source('spotify_stagger_schedule.inc');

test('Chromium media errors are subscribed independently of WebView mute state', () => {
  assert.match(health, /Media\.playerErrorsRaised/);
  assert.match(health, /Media\.enable/);
  assert.doesNotMatch(health, /get_IsMuted/);
  assert.doesNotMatch(health, /put_IsMuted/);
});

test('only local decode and render failures trigger destructive recovery', () => {
  assert.match(health, /MediaPipelineErrorRequiresRebuild/);
  assert.match(health, /pipeline_error_decode/);
  assert.match(health, /decoder_error/);
  assert.match(health, /decrypt/);
  assert.match(health, /cdm_error/);
  assert.match(health, /key_system_error/);
  assert.match(health, /demuxer_error/);
  assert.match(health, /audio_renderer_error/);
  assert.doesNotMatch(
    health,
    /kFatalTokens[\s\S]*?network[\s\S]*?\};/);
  assert.doesNotMatch(
    health,
    /kFatalTokens[\s\S]*?abort[\s\S]*?\};/);
});

test('DRM key waits receive a bounded twenty-second protection window', () => {
  assert.match(health, /kMediaKeyWaitProtectionMs = 20ULL \* 1000ULL/);
  assert.match(health, /MediaPipelineErrorIsKeyWaitRelated/);
  assert.match(stationheadLifecycle, /waitingforkey/);
  assert.match(stationheadLifecycle, /drm-waiting/);
  assert.match(stationheadLifecycle, /drm-ready/);
  assert.match(spotifyEvents, /waitingforkey/);
  assert.match(spotifyEvents, /spotify:drm-waiting/);
  assert.match(spotifyEvents, /spotify:drm-ready/);
  assert.match(stationheadTick, /DRM key wait exceeded twenty seconds/);
  assert.match(spotifyScheduler, /mediaKeyWaitUntilTick/);
});

test('network media recovery reloads with bounded two five fifteen second backoff', () => {
  assert.match(
    health,
    /kMediaNetworkRetryDelaysMs\{[\s\S]*2ULL \* 1000ULL[\s\S]*5ULL \* 1000ULL[\s\S]*15ULL \* 1000ULL/);
  assert.match(health, /MediaPipelineErrorIsNetwork/);
  assert.match(stationhead, /mediaNetworkRecoveryAttempt_ >=[\s\S]*kMediaNetworkRetryDelaysMs\.size/);
  assert.match(stationheadTick, /media network recovery reloading page attempt=/);
  assert.match(spotifyController, /mediaNetworkRecoveryAttempt >=[\s\S]*kMediaNetworkRetryDelaysMs\.size/);
  assert.match(spotifyScheduler, /mediaNetworkRecoveryPending/);
  assert.match(spotifyScheduler, /slot\.webview->Reload\(\)/);
});

test('Stationhead rebuilds its playback WebView on decoder pipeline failure', () => {
  assert.match(stationhead, /SubscribeMediaPipelineErrors/);
  assert.match(stationhead, /Chromium media pipeline failure category=/);
  assert.match(stationhead, /ScheduleRecreate\([\s\S]*Chromium media decode\/pipeline failure/);
  assert.match(stationhead, /UnsubscribeMediaPipelineErrors/);
  assert.match(stationhead, /mediaErrorRecoveryLifecycle_\.lock\(\) == createCallbackAlive_/);
  assert.match(stationhead, /MediaPipelineErrorRequiresRebuild/);
  assert.match(stationhead, /navigationInFlight_\.load/);
  assert.match(stationhead, /kMediaPipelineRebuildCooldownMs/);
  assert.match(stationhead, /mediaErrorRecoveryTick_ = now/);
  assert.doesNotMatch(stationhead, /ApplyAudioPlaybackState\([\s\S]{0,80}Media\.playerErrorsRaised/);
  assert.doesNotMatch(stationhead, /Chromium media pipeline failure: /);
  assert.doesNotMatch(stationhead, /media error observed category=/);
});

test('Spotify defers decoder recovery and rebuilds only the affected surface', () => {
  assert.match(spotifyController, /SubscribeMediaPipelineErrors/);
  assert.match(spotifyController, /mediaPipelineRecoveryPending = true/);
  assert.match(spotifyController, /mediaPipelineRecoveryGeneration ==[\s\S]*targetGeneration/);
  assert.match(spotifyController, /MediaPipelineErrorRequiresRebuild/);
  assert.match(spotifyController, /if \(!SlotStateIsHealthy\(target->state\)\) return S_OK/);
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
