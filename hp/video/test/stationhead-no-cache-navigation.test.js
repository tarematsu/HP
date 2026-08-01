import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const environment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);
const player = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);
const refreshPolicy = readFileSync(
  new URL('../../native/src/sh_track_boundary_message_policy.h', import.meta.url),
  'utf8',
);
const trackBoundaryScript = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const baselinePolicy = readFileSync(
  new URL('../../native/src/sh_stats_july23_baseline_policy_fix.h', import.meta.url),
  'utf8',
);
const playbackPolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);

test('Stationhead WebView resets browser cache before first navigation', () => {
  assert.doesNotMatch(environment, /--disable-http-cache/);
  assert.match(environment, /--disable-features=BackForwardCache,/);
  assert.match(environment, /ApplyWebView2ProcessHints\(\);[\s\S]*CreateCoreWebView2EnvironmentWithOptions/);
  assert.match(
    environment,
    /put_AdditionalBrowserArguments\(webView2Arguments\.c_str\(\)\)/,
  );
  assert.match(
    playbackPolicy,
    /CallDevToolsProtocolMethod\(\s*L"Network\.clearBrowserCache", L"\{\}", nullptr\);/,
  );
  assert.match(player, /NavigateCurrentUrl\(UnixMillis\(\), L"startup"\)/);
});

test('long-lived A and B pages have no 55-minute or 56-minute navigation', () => {
  assert.doesNotMatch(refreshPolicy, /55-minute|56-minute/);
  assert.doesNotMatch(refreshPolicy, /StationheadPeriodicRefreshIntervalMs/);
  assert.doesNotMatch(refreshPolicy, /RefreshPeriodicNavigation/);
  assert.doesNotMatch(refreshPolicy, /periodicRefreshStartedAt_/);
  assert.match(
    trackBoundaryScript,
    /StationheadTrackBoundaryScript\(const wchar_t\*\)[\s\S]*return \{\};/,
  );
  assert.equal(playbackPolicy.match(/Network\.clearBrowserCache/g)?.length, 1,
    'controller configuration should clear cache once');
  assert.equal(baselinePolicy.match(/Network\.clearBrowserCache/g)?.length, 1,
    'July 23 baseline keeps its original controller cache contract');
  assert.equal(environment.match(/BackForwardCache/g)?.length, 1,
    'the shared Stationhead environment should have one page-state cache policy');
});

test('cache reset does not replace or erase the persistent Stationhead login profile', () => {
  const combined = environment + baselinePolicy + playbackPolicy;
  assert.doesNotMatch(environment, /--incognito|--guest|--user-data-dir/);
  assert.doesNotMatch(
    combined,
    /ClearBrowsingDataAll|BROWSING_DATA_KINDS_COOKIES|ALL_SITE|ALL_PROFILE|LOCAL_STORAGE|ALL_DOM_STORAGE|DeleteAllCookies/,
  );
  assert.match(playbackPolicy, /Cookies and DOM storage remain intact/);
});
