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

test('startup reset preserves auth workers only for the Stationhead-owned profile', () => {
  assert.match(helper, /ICoreWebView2_13/);
  assert.match(helper, /get_Profile/);
  assert.match(helper, /get_ProfilePath/);
  assert.match(helper, /get_ProfileName/);
  assert.match(helper, /ICoreWebView2Profile2/);
  assert.match(helper, /ClearBrowsingData/);
  assert.match(helper, /BROWSING_DATA_KINDS_DISK_CACHE/);
  assert.match(helper, /BROWSING_DATA_KINDS_CACHE_STORAGE/);
  assert.match(helper, /BROWSING_DATA_KINDS_SERVICE_WORKERS/);
  assert.match(helper, /_wcsicmp\(rawProfileName, L"spotify-v2-1"\) == 0/);
  assert.match(
    helper,
    /if \(!preservePlaybackWorkers\) \{[\s\S]*BROWSING_DATA_KINDS_CACHE_STORAGE[\s\S]*BROWSING_DATA_KINDS_SERVICE_WORKERS/,
  );
  assert.doesNotMatch(
    helper,
    /BROWSING_DATA_KINDS_(COOKIES|LOCAL_STORAGE|INDEXED_DB|ALL_DOM_STORAGE|ALL_SITE|ALL_PROFILE)|DeleteAllCookies/,
  );
});

test('startup reset is claimed once per persistent WebView profile in one app run', () => {
  assert.match(helper, /ClaimWebViewStartupCacheReset\(profilePath\)/);
  assert.match(helper, /WebViewStartupCacheResetProfiles\(\)\.try_emplace\(profilePath, true\)/);
  assert.match(helper, /if \(!ClaimWebViewStartupCacheReset\(profilePath\)\)[\s\S]*finish\(S_FALSE\)/);
  assert.match(helper, /ReleaseWebViewStartupCacheResetClaim\(profilePath\)/);
});

test('Stationhead waits for startup cache reset before WebView configuration', () => {
  assert.match(stationhead, /#include "webview_startup_cache_reset\.h"/);
  const create = stationhead.indexOf('void StationheadPlayer::Create()');
  const reset = stationhead.indexOf('ResetWebViewStartupCaches(', create);
  const configure = stationhead.indexOf('ConfigureWebView();', reset);
  assert.ok(create >= 0 && reset > create && configure > reset);
});

test('Spotify waits for startup cache reset before its first navigation', () => {
  assert.match(spotifyFoundation, /#include "webview_startup_cache_reset\.h"/);
  const configure = spotifyLifecycle.indexOf('void SpotifyWebViews::Configure(');
  const reset = spotifyLifecycle.indexOf('ResetWebViewStartupCaches(', configure);
  const navigate = spotifyLifecycle.indexOf('Navigate(kSpotifyLoginUrl)', reset);
  assert.ok(configure >= 0 && reset > configure && navigate > reset);
});

test('YouTube/TVer reset startup caches before initial navigation and not on phase switches', () => {
  assert.match(rendererPanels, /#include "webview_startup_cache_reset\.h"/);
  const configure = mediaHost.indexOf('void Configure() noexcept');
  const switchYoutube = mediaHost.indexOf('void SwitchToYouTube() noexcept');
  const reset = mediaHost.indexOf('ResetWebViewStartupCaches(', configure);
  const initialNavigate = mediaHost.indexOf('NavigateCurrentPhase();', reset);
  assert.ok(configure >= 0 && reset > configure && initialNavigate > reset);
  assert.ok(reset < switchYoutube);
  assert.equal(mediaHost.match(/ResetWebViewStartupCaches\(/g)?.length, 1);
});
