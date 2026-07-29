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
const baselinePolicy = readFileSync(
  new URL('../../native/src/sh_stats_july23_baseline_policy_fix.h', import.meta.url),
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
    baselinePolicy,
    /CallDevToolsProtocolMethod\(\s*L"Network\.clearBrowserCache", L"\{\}", nullptr\);/,
  );
  assert.match(player, /NavigateCurrentUrl\(UnixMillis\(\), L"startup"\)/);
});

test('55-minute navigation reuses the session cache until controller recreation', () => {
  assert.match(refreshPolicy, /NavigateCurrentUrl\(nowMs, L"55-minute periodic refresh"\)/);
  assert.equal(baselinePolicy.match(/Network\.clearBrowserCache/g)?.length, 1,
    'cache reset should be registered once at the controller configuration boundary');
  assert.equal(environment.match(/BackForwardCache/g)?.length, 1,
    'the shared Stationhead environment should have one page-state cache policy');
});

test('cache reset does not replace or erase the persistent Stationhead login profile', () => {
  const combined = environment + baselinePolicy;
  assert.doesNotMatch(environment, /--incognito|--guest|--user-data-dir/);
  assert.doesNotMatch(
    combined,
    /ClearBrowsingDataAll|BROWSING_DATA_KINDS_COOKIES|ALL_SITE|ALL_PROFILE|LOCAL_STORAGE|ALL_DOM_STORAGE|DeleteAllCookies/,
  );
});
