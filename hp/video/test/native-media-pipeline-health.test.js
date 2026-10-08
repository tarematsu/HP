import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url), 'utf8');

const health = source('media_pipeline_health.h');
const stationhead = source('sh_webview.cpp');
const stationheadLifecycle = source('sh_runtime_lifecycle_script.h');
const stationheadTick = source('sh.cpp');

test('Chromium media errors are subscribed independently of WebView mute state', () => {
  assert.match(health, /Media\.playerErrorsRaised/);
  assert.match(health, /Media\.enable/);
  assert.doesNotMatch(health, /get_IsMuted/);
  assert.doesNotMatch(health, /put_IsMuted/);
});

test('media errors are classified structurally with fatal DRM network priority', () => {
  assert.match(health, /JsonObject::Parse\(parameters\)/);
  assert.match(health, /GetNamedValue\(L"errors"\)/);
  assert.match(health, /GetNamedValue\(L"errorType"\)/);
  assert.match(health, /GetNamedValue\(L"code"\)/);
  assert.match(health, /GetNamedValue\(L"cause"\)/);
  assert.match(
    health,
    /enum class MediaPipelineRecoveryKind[\s\S]*None = 0[\s\S]*Network = 1[\s\S]*KeyWait = 2[\s\S]*Rebuild = 3/);
  assert.match(health, /PreferMediaPipelineClassification/);
  assert.match(health, /ClassifyMediaPipelineErrorObject\(cause\.GetObject\(\)\)/);
  assert.match(health, /result\.kind == MediaPipelineRecoveryKind::Rebuild/);
});

test('pipeline numeric codes are scoped to PipelineStatus families', () => {
  assert.match(health, /pipelineStatusCode/);
  assert.match(health, /MediaPipelineErrorContains\(errorType, L"pipeline"\)/);
  assert.match(health, /ClassifyPipelineStatusCode/);
  assert.match(health, /case 2:[\s\S]*PIPELINE_ERROR_NETWORK/);
  assert.match(health, /case 3:[\s\S]*PIPELINE_ERROR_DECODE/);
  assert.match(health, /case 4:[\s\S]*PIPELINE_ERROR_DECRYPT/);
  assert.match(health, /case 19:[\s\S]*AUDIO_RENDERER_ERROR/);
});

test('only local decode render and DRM failures trigger destructive recovery', () => {
  assert.match(health, /MediaPipelineErrorRequiresRebuild/);
  assert.match(health, /pipeline_error_decode/);
  assert.match(health, /decoder_error/);
  assert.match(health, /decrypt/);
  assert.match(health, /cdm_error/);
  assert.match(health, /key_system_error/);
  assert.match(health, /demuxer_error/);
  assert.match(health, /audio_renderer_error/);
  assert.match(
    health,
    /MediaPipelineErrorRequiresRebuild[\s\S]*MediaPipelineRecoveryKind::Rebuild[\s\S]*MediaPipelineRecoveryKind::KeyWait/);
  assert.match(
    health,
    /MediaPipelineErrorIsNetwork[\s\S]*MediaPipelineRecoveryKind::Network/);
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

