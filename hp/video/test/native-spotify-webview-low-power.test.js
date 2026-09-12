import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);
const environment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

test('healthy Spotify playback uses the compact low-power host', () => {
  assert.match(layout, /kSpotifyLowPowerPlaybackWidth = 96/);
  assert.match(layout, /kSpotifyLowPowerPlaybackHeight = 54/);
  assert.match(
    layout,
    /const bool lowPowerPlayback =[\s\S]*SlotStateIsHealthy\(slot\.state\)[\s\S]*healthyMusicReadyToHide \|\| healthyPodcastReadyToHide/,
  );
  assert.match(layout, /width = lowPowerPlayback[\s\S]*kSpotifyLowPowerPlaybackWidth/);
  assert.match(layout, /height = lowPowerPlayback[\s\S]*kSpotifyLowPowerPlaybackHeight/);
  assert.match(layout, /put_IsVisible\(lowPowerPlayback \? FALSE : TRUE\)/);
});

test('healthy Spotify playback requests LOW WebView2 memory usage', () => {
  assert.match(layout, /ComPtr<ICoreWebView2_19> memoryView/);
  assert.match(layout, /put_MemoryUsageTargetLevel/);
  assert.match(layout, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.match(layout, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
});

test('shared WebView environment leaves Chromium occlusion throttling enabled', () => {
  assert.match(environment, /--autoplay-policy=no-user-gesture-required/);
  assert.doesNotMatch(environment, /--disable-backgrounding-occluded-windows/);
});
