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

test('Spotify playback keeps a visible 1x1 steady host without memory-policy COM calls in layout', () => {
  assert.match(layout, /int width = 1;/);
  assert.match(layout, /int height = 1;/);
  assert.match(layout, /HWND insertAfter = HWND_BOTTOM;/);
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
  assert.doesNotMatch(layout, /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
});

test('Spotify recovery retains a bounded temporary viewport for trusted input', () => {
  assert.match(layout, /kSpotifyRecoveryInteractionWidth = 720/);
  assert.match(layout, /kSpotifyRecoveryInteractionHeight = 480/);
  assert.match(layout, /else if \(recovery\)/);
});

test('Spotify low-memory policy remains permanent while controller visibility stays true', () => {
  assert.match(controller, /ApplySpotifyPermanentLowMemoryMode\(slot\.webview\.Get\(\)\)/);
  assert.match(controller, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.match(controller, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.doesNotMatch(controller, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
  assert.doesNotMatch(controller, /slot\.controller->put_IsVisible\(FALSE\)/);
  assert.equal((controller.match(/ApplySpotifyPermanentLowMemoryMode\(/g) || []).length, 2);
});

test('shared WebView environment disables Chromium occluded-window backgrounding', () => {
  assert.match(environment, /--autoplay-policy=no-user-gesture-required/);
  assert.match(environment, /--disable-backgrounding-occluded-windows/);
});
