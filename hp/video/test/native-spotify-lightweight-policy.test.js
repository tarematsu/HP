import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const policy = readNative('spotify_lightweight_policy.inc');
const controller = readNative('spotify_controller_lifecycle.inc');
const wrapper = readNative('spotify_webviews.cpp');

test('Spotify lightweight policy is wired before controller lifecycle code', () => {
  assert.match(wrapper, /#include "spotify_webview_foundation\.inc"[\s\S]*#include "spotify_lightweight_policy\.inc"[\s\S]*#include "spotify_controller_lifecycle\.inc"/);
  assert.match(controller, /ConfigureSpotifyLightweightResourcePolicy\([\s\S]*slot\.environment\.Get\(\), slot\.webview\.Get\(\), alive\)/);
  assert.match(controller, /if \(!playerPage\) \{ ArmRobustScheduler\(\); return S_OK; \}[\s\S]*ApplySpotifyLightweightCss\(sender\)/);
});

test('Spotify CSS reduction stays visual-only and avoids playback DOM', () => {
  assert.match(policy, /location\.hostname !== 'open\.spotify\.com'/);
  assert.match(policy, /homepanel-spotify-lightweight/);
  assert.match(policy, /data-testid="global-nav-bar"/);
  assert.match(policy, /data-testid="left-sidebar"/);
  assert.match(policy, /data-testid="right-sidebar"/);
  assert.match(policy, /data-testid\*="skeleton"/);
  assert.match(policy, /img,[\s\S]*picture[\s\S]*visibility: hidden/);
  assert.doesNotMatch(policy, /main section|content-visibility|pointer-events/);
  assert.doesNotMatch(policy, /play-button|control-button-playpause|audio\b|video\b|now-playing/);
  assert.doesNotMatch(policy, /MutationObserver/);
});

test('Spotify blocks images and fonts at the request layer for every page', () => {
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT/);
  assert.match(policy, /CreateWebResourceResponse\([\s\S]*204, L"No Content"/);
  assert.doesNotMatch(policy, /get_Source\(/);
  assert.doesNotMatch(policy, /playerPage/);

  for (const context of [
    'MEDIA', 'SCRIPT', 'STYLESHEET', 'XML_HTTP_REQUEST', 'FETCH', 'WEBSOCKET',
    'TEXT_TRACK', 'MANIFEST', 'PING', 'CSP_VIOLATION_REPORT',
  ]) {
    assert.doesNotMatch(
      policy,
      new RegExp(`COREWEBVIEW2_WEB_RESOURCE_CONTEXT_${context}`),
    );
  }
  assert.doesNotMatch(policy, /Network\.setBlockedURLs/);
});
