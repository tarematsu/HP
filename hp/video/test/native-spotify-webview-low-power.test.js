import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);
const controller = readFileSync(
  new URL('../../native/src/spotify_controller_lifecycle.inc', import.meta.url),
  'utf8',
);
const environment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

test('Spotify playback keeps compact host geometry while controller rendering stays hidden', () => {
  assert.match(layout, /kSpotifyLowPowerPlaybackWidth = 96/);
  assert.match(layout, /kSpotifyLowPowerPlaybackHeight = 54/);
  assert.match(
    layout,
    /const bool lowPowerPlayback =[\s\S]*SlotStateIsHealthy\(slot\.state\)[\s\S]*CurrentMusicTrack\(slot\)/,
  );
  assert.match(layout, /width = lowPowerPlayback[\s\S]*kSpotifyLowPowerPlaybackWidth/);
  assert.match(layout, /height = lowPowerPlayback[\s\S]*kSpotifyLowPowerPlaybackHeight/);
  assert.match(layout, /slot\.controller->put_IsVisible\(FALSE\)/);
  assert.doesNotMatch(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
});

test('Spotify WebViews always request the low memory target', () => {
  assert.match(layout, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.match(layout, /put_MemoryUsageTargetLevel/);
  assert.match(controller, /ApplySpotifyPermanentLowMemoryMode/);
  assert.match(controller, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.doesNotMatch(controller, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
});

test('shared WebView environment disables Chromium occluded-window backgrounding', () => {
  assert.match(environment, /--autoplay-policy=no-user-gesture-required/);
  assert.match(environment, /--disable-backgrounding-occluded-windows/);
});
