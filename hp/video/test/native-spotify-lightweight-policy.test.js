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

test('Spotify CSS narrows presentation suppression and removes non-playback DOM', () => {
  assert.match(policy, /location\.hostname !== 'open\.spotify\.com'/);
  assert.match(policy, /homepanel-spotify-lightweight/);
  assert.doesNotMatch(policy, /\*, \*::before, \*::after/);
  assert.match(policy, /html,[\s\S]*body,[\s\S]*#main,[\s\S]*main,[\s\S]*nav,[\s\S]*aside,[\s\S]*footer/);
  assert.match(policy, /data-testid="main-view-container"/);
  assert.match(policy, /animation: none !important/);
  assert.match(policy, /animation-play-state: paused !important/);
  assert.match(policy, /transition: none !important/);
  assert.match(policy, /will-change: auto !important/);
  assert.match(policy, /view-transition-name: none !important/);
  assert.match(policy, /data-testid="global-nav-bar"/);
  assert.match(policy, /data-testid="left-sidebar"/);
  assert.match(policy, /data-testid="right-sidebar"/);
  assert.match(policy, /data-testid="tracklist-row"/);
  assert.match(policy, /data-testid\*="recommendation" i/);
  assert.match(policy, /data-testid\*="related" i/);
  assert.match(policy, /picture,[\s\S]*img,[\s\S]*canvas/);
  assert.match(policy, /content-visibility: hidden !important/);
  assert.match(policy, /contain: strict !important/);
  assert.doesNotMatch(policy, /audio\b|video\b|now-playing-widget|control-button-playpause/);
  assert.doesNotMatch(policy, /MutationObserver/);
});

test('Spotify keeps authentication images available while shared fonts stay reduced', () => {
  assert.doesNotMatch(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_(?:IMAGE|FONT)/);
  assert.doesNotMatch(policy, /AddWebResourceRequestedFilter|add_WebResourceRequested/);
  assert.match(environment, /L"webview2-youtube-mv"/);
  assert.match(environment, /blockImages = mediaUdf;/);
  assert.match(environment, /blockFonts = true;/);
  assert.match(environment, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(environment, /downloadableBinaryFontsEnabled=false/);
});
