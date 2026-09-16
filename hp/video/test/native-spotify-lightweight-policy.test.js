import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const policy = readNative('spotify_lightweight_policy.inc');
const controller = readNative('spotify_controller_lifecycle.inc');
const wrapper = readNative('spotify_webviews.cpp');
const environment = readNative('shared_webview_environment.cpp');

test('Spotify lightweight CSS is wired before controller lifecycle code', () => {
  assert.match(wrapper, /#include "spotify_webview_foundation\.inc"[\s\S]*#include "spotify_lightweight_policy\.inc"[\s\S]*#include "spotify_controller_lifecycle\.inc"/);
  assert.doesNotMatch(controller, /ConfigureSpotifyLightweightResourcePolicy/);
  assert.match(controller, /if \(!playerPage\) \{ ArmRobustScheduler\(\); return S_OK; \}[\s\S]*ApplySpotifyLightweightCss\(sender\)/);
});

test('Spotify CSS reduction stays visual-only and avoids image or playback DOM suppression', () => {
  assert.match(policy, /location\.hostname !== 'open\.spotify\.com'/);
  assert.match(policy, /homepanel-spotify-lightweight/);
  assert.match(policy, /data-testid="global-nav-bar"/);
  assert.match(policy, /data-testid="left-sidebar"/);
  assert.match(policy, /data-testid="right-sidebar"/);
  assert.match(policy, /data-testid\*="skeleton"/);
  assert.doesNotMatch(policy, /img,[\s\S]*picture[\s\S]*visibility: hidden/);
  assert.doesNotMatch(policy, /main section|content-visibility|pointer-events/);
  assert.doesNotMatch(policy, /play-button|control-button-playpause|audio\b|video\b|now-playing/);
  assert.doesNotMatch(policy, /MutationObserver/);
});

test('Spotify delegates image and downloadable-font suppression to the shared UDF', () => {
  assert.doesNotMatch(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_(?:IMAGE|FONT)/);
  assert.doesNotMatch(policy, /AddWebResourceRequestedFilter|add_WebResourceRequested/);
  assert.match(environment, /blockImages = true;/);
  assert.match(environment, /blockFonts = true;/);
  assert.match(environment, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(environment, /downloadableBinaryFontsEnabled=false/);
});
