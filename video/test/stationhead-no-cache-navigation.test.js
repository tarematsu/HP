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

test('Stationhead WebView disables HTTP and page-state caches before first navigation', () => {
  assert.match(environment, /L"--disable-http-cache "/);
  assert.match(environment, /--disable-features=BackForwardCache,/);
  assert.match(
    environment,
    /ApplyWebView2ProcessHints\(\);[\s\S]*CreateCoreWebView2EnvironmentWithOptions/,
  );
  assert.match(
    environment,
    /put_AdditionalBrowserArguments\(kWebView2Arguments\)/,
  );
  assert.match(
    player,
    /NavigateCurrentUrl\(UnixMillis\(\), L"startup"\)/,
  );
});

test('52-minute track-boundary navigation uses the same cache-disabled environment', () => {
  assert.match(
    player,
    /NavigateCurrentUrl\(nowMs, L"track-boundary authentication refresh"\)/,
  );
  assert.equal(
    environment.match(/--disable-http-cache/g)?.length,
    1,
    'the shared Stationhead environment should have one HTTP cache policy',
  );
  assert.equal(
    environment.match(/BackForwardCache/g)?.length,
    1,
    'the shared Stationhead environment should have one page-cache policy',
  );
});

test('cache bypass does not replace or erase the persistent Stationhead profile', () => {
  assert.doesNotMatch(environment, /--incognito|--guest|--user-data-dir/);
  assert.doesNotMatch(environment, /COOKIES|ALL_SITE|ALL_PROFILE|LOCAL_STORAGE/);
});
