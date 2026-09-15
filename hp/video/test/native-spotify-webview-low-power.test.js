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

test('Spotify confirmed playback keeps a visible 1x1 host without memory-policy COM calls in layout', () => {
  assert.match(layout, /const bool compactPlayback =\s*slot\.playbackConfirmed && CurrentMusicTrack\(slot\) != nullptr/);
  assert.match(layout, /int width = compactPlayback \? 1 : mediaPanelWidth;/);
  assert.match(layout, /int height = compactPlayback \? 1 : mediaPanelHeight;/);
  assert.match(layout, /HWND insertAfter = HWND_BOTTOM;/);
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
  assert.doesNotMatch(layout, /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
});

test('Spotify pre-playback recovery matches the YouTube/TVer panel behind native UI', () => {
  assert.match(layout, /SpotifyMediaPanelRect\(parentWindow_, &mediaPanelRect\)/);
  assert.match(layout, /int x = mediaPanelRect\.left;/);
  assert.match(layout, /int y = mediaPanelRect\.top;/);
  assert.match(layout, /int width = compactPlayback \? 1 : mediaPanelWidth;/);
  assert.match(layout, /int height = compactPlayback \? 1 : mediaPanelHeight;/);
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
  assert.doesNotMatch(layout, /else if \(recovery\)/);
});

test('Spotify leaves WebView2 memory target unmanaged while controller visibility stays true', () => {
  assert.match(controller, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(controller, /ApplySpotifyPermanentLowMemoryMode/);
  assert.doesNotMatch(controller, /put_MemoryUsageTargetLevel/);
  assert.doesNotMatch(controller, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/);
  assert.doesNotMatch(controller, /slot\.controller->put_IsVisible\(FALSE\)/);
});

test('shared WebView environment leaves Chromium occluded-window backgrounding enabled', () => {
  assert.match(environment, /--autoplay-policy=no-user-gesture-required/);
  assert.doesNotMatch(environment, /--disable-backgrounding-occluded-windows/);
});
