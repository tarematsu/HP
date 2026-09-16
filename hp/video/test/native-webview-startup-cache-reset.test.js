import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const helper = read('../../native/src/webview_startup_cache_reset.h');
const stationhead = read('../../native/src/sh.cpp');
const spotifyFoundation = read('../../native/src/spotify_webview_foundation.inc');
const spotifyLifecycle = read('../../native/src/spotify_controller_lifecycle.inc');
const rendererPanels = read('../../native/src/renderer_panels.cpp');
const mediaHost = read('../../native/src/renderer_panels/media_host.inc');

test('startup cache/data deletion engine is removed', () => {
  assert.doesNotMatch(helper, /ICoreWebView2_13|ICoreWebView2Profile|ICoreWebView2Profile2/);
  assert.doesNotMatch(helper, /get_Profile|get_ProfilePath|get_ProfileName/);
  assert.doesNotMatch(helper, /ClearBrowsingData|DeleteAllCookies|RemoveAllCookies/);
  assert.doesNotMatch(helper, /COREWEBVIEW2_BROWSING_DATA_KINDS|BROWSING_DATA_KINDS_/);
  assert.doesNotMatch(helper, /CacheStorage|SERVICE_WORKERS|DISK_CACHE/);
  assert.match(helper, /completion\(S_OK\)/);
});

test('Spotify no longer routes startup through the cache-reset compatibility shim', () => {
  assert.doesNotMatch(spotifyFoundation, /webview_startup_cache_reset\.h/);
  assert.doesNotMatch(spotifyLifecycle, /ResetWebViewStartupCaches/);
  assert.match(
    spotifyLifecycle,
    /SetSlotState\(slot, SlotState::Authenticating\);[\s\S]*slot\.webview->Navigate\(kSpotifyLoginUrl\)/,
  );
});

test('remaining legacy startup call sites can only pass through synchronously', () => {
  assert.match(stationhead, /#include "webview_startup_cache_reset\.h"/);
  assert.match(rendererPanels, /#include "webview_startup_cache_reset\.h"/);
  assert.match(stationhead, /ResetWebViewStartupCaches\(/);
  assert.match(mediaHost, /ResetWebViewStartupCaches\(/);
  assert.doesNotMatch(helper, /std::mutex|std::map|try_emplace|profilePath/);
});
