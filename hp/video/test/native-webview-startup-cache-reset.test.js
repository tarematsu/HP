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

test('startup cache deletion is restricted to Stationhead HTTP disk cache', () => {
  assert.match(helper, /ICoreWebView2_13/);
  assert.match(helper, /ICoreWebView2Profile2/);
  assert.match(helper, /IsStationheadStartupCacheProfile/);
  assert.match(helper, /L"spotify-v2-1"/);
  assert.match(
    helper,
    /ClearBrowsingData\(\s*COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE/,
  );
  assert.doesNotMatch(helper, /DeleteAllCookies|RemoveAllCookies/);
  assert.doesNotMatch(
    helper,
    /BROWSING_DATA_KINDS_(?:ALL_DOM_STORAGE|COOKIES|INDEXED_DB|LOCAL_STORAGE|SERVICE_WORKERS|CACHE_STORAGE)/,
  );
});

test('Spotify no longer routes startup through the cache-reset compatibility shim', () => {
  assert.doesNotMatch(spotifyFoundation, /webview_startup_cache_reset\.h/);
  assert.doesNotMatch(spotifyLifecycle, /ResetWebViewStartupCaches/);
  assert.match(
    spotifyLifecycle,
    /SetSlotState\(slot, SlotState::Authenticating\);[\s\S]*slot\.webview->Navigate\(kSpotifyLoginUrl\)/,
  );
});

test('legacy reset call sites are gated by the Stationhead profile and once-per-process claim', () => {
  assert.match(stationhead, /#include "webview_startup_cache_reset\.h"/);
  assert.match(rendererPanels, /#include "webview_startup_cache_reset\.h"/);
  assert.match(stationhead, /ResetWebViewStartupCaches\(/);
  assert.match(mediaHost, /ResetWebViewStartupCaches\(/);
  assert.match(helper, /ClaimWebViewStartupCacheReset\(profilePath\)/);
  assert.match(helper, /WebViewStartupCacheResetProfiles\(\)\.try_emplace/);
  assert.match(helper, /if \(!IsStationheadStartupCacheProfile\(profile\.Get\(\), profilePath\)\)/);
});
