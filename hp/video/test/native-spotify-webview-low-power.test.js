import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);
const layout = source('spotify_host_layout.inc');
const controller = source('spotify_controller_lifecycle.inc');
const phase = source('spotify_phase_sync.inc');
const resourceMode = source('spotify_permanent_resource_mode.h');
const environment = source('shared_webview_environment.cpp');

test('Spotify confirmed playback keeps a visible Monitor S tile behind native UI', () => {
  assert.match(layout, /const RECT serviceTile = ServiceMonitorTileBounds\(client, i \+ 1\)/);
  assert.match(layout, /const RECT desired = loginPage \? fullClient : serviceTile/);
  assert.match(layout, /const bool gridForeground = gSpotifyMonitorGridVisible && !loginPage/);
  assert.match(layout, /gridForeground \|\| monitorForeground \|\| authenticationForeground/);
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|ComputeMediaSurfaceAnchors|anchors\.air|CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
});

test('Spotify pre-playback recovery uses the same fixed Monitor S tile behind native UI', () => {
  assert.match(layout, /ServiceMonitorTileBounds\(client, i \+ 1\)/);
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
  assert.doesNotMatch(layout, /else if \(recovery\)/);
});

test('Spotify is permanently LOW memory and reapplies Efficiency mode across state changes', () => {
  assert.match(phase, /#include "spotify_permanent_resource_mode\.h"/);
  assert.match(phase, /slot\.state = state;[\s\S]*ApplySpotifyPermanentResourceMode\(slot\)/);
  assert.match(resourceMode, /ICoreWebView2_19/);
  assert.match(resourceMode, /put_MemoryUsageTargetLevel\([\s\S]*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.doesNotMatch(resourceMode, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
  assert.match(resourceMode, /ProcessPowerThrottling/);
  assert.match(resourceMode, /PROCESS_POWER_THROTTLING_EXECUTION_SPEED/);
  assert.match(resourceMode, /BELOW_NORMAL_PRIORITY_CLASS/);
  assert.match(controller, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(controller, /slot\.controller->put_IsVisible\(FALSE\)/);
});

test('shared WebView environment leaves Chromium background throttling enabled', () => {
  assert.match(environment, /--autoplay-policy=no-user-gesture-required/);
  assert.doesNotMatch(environment, /--disable-backgrounding-occluded-windows/);
  assert.doesNotMatch(environment, /--disable-renderer-backgrounding/);
  assert.doesNotMatch(environment, /--disable-background-timer-throttling/);
});
