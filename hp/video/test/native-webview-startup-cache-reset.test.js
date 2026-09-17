import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const helper = read('../../native/src/webview_startup_cache_reset.h');
const stationhead = read('../../native/src/sh.cpp');
const spotifySource = read('../../native/src/spotify_webviews.cpp');
const spotifyLifecycle = read('../../native/src/spotify_controller_lifecycle.inc');
const rendererPanels = read('../../native/src/renderer_panels.cpp');
const mediaHost = read('../../native/src/renderer_panels/media_host.inc');

test('normal startup preserves profile data and repair is gated by repeated churn', () => {
  assert.match(helper, /Normal startup never deletes profile data/);
  assert.match(helper, /kChurnWindowMs = 5ULL \* 60ULL \* 1000ULL/);
  assert.match(helper, /kRepairCooldownMs = 30ULL \* 60ULL \* 1000ULL/);
  assert.match(helper, /kChurnThreshold = 3/);
  assert.match(helper, /state\.creations >= webview_profile_recovery::kChurnThreshold/);
});

test('recovery clears only transient caches and keeps authentication storage', () => {
  assert.match(helper, /ICoreWebView2Profile2/);
  assert.match(helper, /ClearBrowsingData/);
  assert.match(helper, /BROWSING_DATA_KINDS_CACHE_STORAGE/);
  assert.match(helper, /BROWSING_DATA_KINDS_SERVICE_WORKERS/);
  assert.match(helper, /BROWSING_DATA_KINDS_DISK_CACHE/);
  assert.doesNotMatch(
    helper,
    /BROWSING_DATA_KINDS_(?:COOKIES|INDEXED_DB|LOCAL_STORAGE|PASSWORD_AUTOSAVE|ALL_DOM_STORAGE|ALL_PROFILE)/,
  );
});

test('Spotify joins the same recovery-only profile repair path', () => {
  assert.match(spotifySource, /#include "webview_startup_cache_reset\.h"/);
  assert.match(spotifyLifecycle, /ResetWebViewStartupCaches\(/);
  assert.match(
    spotifyLifecycle,
    /controllerCreating = true;[\s\S]*ResetWebViewStartupCaches\([\s\S]*target->webview = startupView;[\s\S]*Configure\(\*target\)/,
  );
});

test('Stationhead and native media retain the shared repair hook', () => {
  assert.match(stationhead, /#include "webview_startup_cache_reset\.h"/);
  assert.match(rendererPanels, /#include "webview_startup_cache_reset\.h"/);
  assert.match(stationhead, /ResetWebViewStartupCaches\(/);
  assert.match(mediaHost, /ResetWebViewStartupCaches\(/);
});
