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

test('only the former amazon profile gets a one-time tgut login reset', () => {
  assert.match(helper, /kTgutStationheadProfileName\[\]\s*=\s*L"spotify-v2-1"/);
  assert.match(helper, /kTgutLoginResetMarker\[\]\s*=\s*L"\.homepanel-tgut-login-reset-v1\.done"/);
  assert.match(helper, /ICoreWebView2_13/);
  assert.match(helper, /get_Profile\(&profile\)/);
  assert.match(helper, /get_ProfileName\(&profileNameRaw\)/);
  assert.match(helper, /_wcsicmp\(profileName\.c_str\(\), detail::kTgutStationheadProfileName\) != 0/);
  assert.match(helper, /get_ProfilePath\(&profilePathRaw\)/);
  assert.match(helper, /fs::exists\(markerPath, markerError\)/);
  assert.match(helper, /ICoreWebView2Profile2/);
  assert.match(helper, /ClearBrowsingData\(/);
  assert.match(helper, /BROWSING_DATA_KINDS_COOKIES/);
  assert.match(helper, /BROWSING_DATA_KINDS_ALL_DOM_STORAGE/);
  assert.match(helper, /BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE/);
  assert.match(helper, /BROWSING_DATA_KINDS_GENERAL_AUTOFILL/);
  assert.doesNotMatch(helper, /BROWSING_DATA_KINDS_DISK_CACHE/);
  assert.match(helper, /marker << "tgut-login-reset-v1\\n"/);
});

test('Spotify no longer routes startup through the cache-reset compatibility shim', () => {
  assert.doesNotMatch(spotifyFoundation, /webview_startup_cache_reset\.h/);
  assert.doesNotMatch(spotifyLifecycle, /ResetWebViewStartupCaches/);
  assert.match(
    spotifyLifecycle,
    /SetSlotState\(slot, SlotState::Authenticating\);[\s\S]*slot\.webview->Navigate\(kSpotifyLoginUrl\)/,
  );
});

test('the shared startup hook keeps every non-tgut profile intact', () => {
  assert.match(stationhead, /#include "webview_startup_cache_reset\.h"/);
  assert.match(rendererPanels, /#include "webview_startup_cache_reset\.h"/);
  assert.match(stationhead, /ResetWebViewStartupCaches\(/);
  assert.match(mediaHost, /ResetWebViewStartupCaches\(/);
  assert.match(
    helper,
    /if \(_wcsicmp\(profileName\.c_str\(\), detail::kTgutStationheadProfileName\) != 0\) \{[\s\S]*CompleteWebViewStartupReset\(completion, S_OK\);[\s\S]*return;/,
  );
  assert.doesNotMatch(helper, /ClaimWebViewStartupCacheReset|WebViewStartupCacheResetProfiles/);
});
