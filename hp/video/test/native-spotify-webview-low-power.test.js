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

test('Spotify confirmed playback keeps a visible onscreen 160x320 host behind the air panel without memory-policy COM calls in layout', () => {
  assert.match(layout, /kSpotifyBackgroundWidth = 160/);
  assert.match(layout, /kSpotifyBackgroundHeight = 320/);
  assert.match(layout, /ComputeMediaSurfaceAnchors\(client\)/);
  assert.match(layout, /anchors\.air/);
  assert.match(layout, /CenterMediaSurfaceOnAnchor/);
  assert.match(layout, /const int hostX = backgroundSurface\.left;/);
  assert.match(layout, /const int hostY = backgroundSurface\.top;/);
  assert.match(layout, /authentication \|\| monitorForeground_ \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(layout, /client\.right \+ 1|client\.bottom \+ 1/);
  assert.doesNotMatch(layout, /width = clientWidth|height = clientHeight/);
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
  assert.doesNotMatch(layout, /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
});

test('Spotify pre-playback recovery uses the same fixed air-panel background surface behind native UI', () => {
  assert.match(layout, /ComputeMediaSurfaceAnchors\(client\)/);
  assert.match(layout, /anchors\.air/);
  assert.match(layout, /CenterMediaSurfaceOnAnchor/);
  assert.match(layout, /backgroundSurface\.right - backgroundSurface\.left/);
  assert.match(layout, /backgroundSurface\.bottom - backgroundSurface\.top/);
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
