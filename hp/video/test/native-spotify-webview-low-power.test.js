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

test('Spotify confirmed playback keeps a visible full-client host behind native UI without memory-policy COM calls in layout', () => {
  assert.match(layout, /const int hostX = client\.left;/);
  assert.match(layout, /const int hostY = client\.top;/);
  assert.match(layout, /client\.right - client\.left/);
  assert.match(layout, /client\.bottom - client\.top/);
  assert.match(layout, /monitorForeground \|\| authenticationForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|ComputeMediaSurfaceAnchors|anchors\.air|CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
  assert.doesNotMatch(layout, /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
});

test('Spotify pre-playback recovery uses the same full-client background surface behind native UI', () => {
  assert.match(layout, /client\.right - client\.left/);
  assert.match(layout, /client\.bottom - client\.top/);
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

test('shared WebView environment keeps background playback timers and renderers active', () => {
  assert.match(environment, /--autoplay-policy=no-user-gesture-required/);
  assert.match(environment, /--disable-backgrounding-occluded-windows/);
  assert.match(environment, /--disable-renderer-backgrounding/);
  assert.match(environment, /--disable-background-timer-throttling/);
});
