import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const spotifyController = source('spotify_controller_lifecycle.inc');
const spotifyPhase = source('spotify_phase_sync.inc');
const spotifyPolicy = source('spotify_runtime_policy.inc');
const stationheadLayout = source('sh_layout.cpp');
const stationheadWebview = source('sh_webview.cpp');
const stationheadAudioLoss = source('sh_audio_loss.cpp');
const stationheadAudioLossPolicy = source('sh_audio_loss_policy.h');
const stationheadBoundaryPolicy = source('sh_track_boundary_message_policy.h');
const mediaHost = source('renderer_panels/media_host.inc');
const featurePolicy = source('webview_feature_policy.h');

test('YouTube/TVer keep the experimental WebView2 low-memory target', () => {
  assert.match(
    mediaHost,
    /ApplyMediaWebViewFeaturePolicy\(\s*controller_\.Get\(\), webview_\.Get\(\), false\)/,
    'YouTube/TVer must use the native-media feature-policy path',
  );
  assert.match(
    featurePolicy,
    /if \(!webMessagesEnabled\) \{[\s\S]*ICoreWebView2_19[\s\S]*put_MemoryUsageTargetLevel\([\s\S]*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/,
    'native YouTube/TVer must request the low memory target',
  );
});

test('Stationhead playback recovery does not apply a LOW memory target', () => {
  assert.match(
    stationheadAudioLossPolicy,
    /kStationheadAudioLossArmStabilityMs = 5'000/,
    'audio-loss fallback keeps its independent five-second stability guard',
  );
  assert.doesNotMatch(
    stationheadAudioLoss,
    /ApplyStationheadPlaybackMemoryTarget|put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/,
  );
  assert.match(
    stationheadAudioLoss,
    /StationheadAudioLossCanArm\(\s*true, navigationActive, playingForMs\)/,
    'audio-loss fallback arming remains independent from WebView2 memory targeting',
  );
});

test('Stationhead periodic navigation only restores the normal target', () => {
  assert.match(
    stationheadBoundaryPolicy,
    /RestoreStationheadPlaybackMemoryTargetForReload[\s\S]*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/,
  );
  assert.doesNotMatch(
    stationheadBoundaryPolicy.match(
      /inline void RestoreStationheadPlaybackMemoryTargetForReload[\s\S]*?\n}\n/,
    )?.[0] ?? '',
    /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/,
  );
});

test('Spotify and Stationhead layout/auth setup do not apply an unconditional memory target', () => {
  for (const [name, implementation] of [
    ['Stationhead layout', stationheadLayout],
    ['Stationhead WebView setup', stationheadWebview],
  ]) {
    assert.doesNotMatch(
      implementation,
      /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
      `${name} must not apply an unconditional WebView2 memory target`,
    );
  }

  assert.match(
    spotifyController,
    /ApplyMediaWebViewFeaturePolicy\([\s\S]*true\)/,
    'Spotify must keep script/web-message media policy enabled',
  );
  assert.match(
    stationheadWebview,
    /ApplyMediaWebViewFeaturePolicy\(controller_\.Get\(\), webview_\.Get\(\), true\)/,
    'Stationhead startup must begin on the normal media policy path',
  );
});

test('Spotify leaves the WebView2 memory target unmanaged', () => {
  assert.doesNotMatch(
    spotifyPolicy,
    /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
  );
  assert.doesNotMatch(
    spotifyPhase,
    /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)|SetSpotifyMemoryUsageTarget/,
  );
  assert.match(
    spotifyPhase,
    /state == SlotState::NotCreated \|\| state == SlotState::Authenticating \|\|\s*state == SlotState::Playing[\s\S]*slot\.nextRecoveryTick = 0/,
  );
  assert.match(
    spotifyPhase,
    /MarkSlotRecovering[\s\S]*SetSlotState\(slot, SlotState::Recovering\)/,
  );
});
