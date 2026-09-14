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

test('Spotify playback keeps compact host geometry without resource-policy COM calls in layout', () => {
  assert.match(layout, /kSpotifyLowPowerPlaybackWidth = 96/);
  assert.match(layout, /kSpotifyLowPowerPlaybackHeight = 54/);
  assert.match(
    layout,
    /const bool lowPowerPlayback =[\s\S]*SlotStateIsHealthy\(slot\.state\)[\s\S]*CurrentMusicTrack\(slot\)/,
  );
  assert.match(layout, /width = lowPowerPlayback[\s\S]*kSpotifyLowPowerPlaybackWidth/);
  assert.match(layout, /height = lowPowerPlayback[\s\S]*kSpotifyLowPowerPlaybackHeight/);
  assert.doesNotMatch(layout, /put_IsVisible/);
  assert.doesNotMatch(layout, /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
});

test('Spotify resource policy is applied once during controller configuration', () => {
  assert.match(controller, /ApplySpotifyPermanentLowMemoryMode\(slot\.webview\.Get\(\)\)/);
  assert.match(controller, /slot\.controller->put_IsVisible\(FALSE\)/);
  assert.match(controller, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.doesNotMatch(controller, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
  assert.equal((controller.match(/ApplySpotifyPermanentLowMemoryMode\(/g) || []).length, 2);
  assert.equal((controller.match(/slot\.controller->put_IsVisible\(FALSE\)/g) || []).length, 1);
});

test('shared WebView environment disables Chromium occluded-window backgrounding', () => {
  assert.match(environment, /--autoplay-policy=no-user-gesture-required/);
  assert.match(environment, /--disable-backgrounding-occluded-windows/);
});
