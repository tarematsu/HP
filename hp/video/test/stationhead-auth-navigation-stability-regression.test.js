import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const eventPolicySource = readFileSync(
  new URL('../../native/src/sh_webview_event_policy.h', import.meta.url),
  'utf8',
);
const finalResourcePolicySource = readFileSync(
  new URL('../../native/src/sh_runtime_resource_filter_policy_fix.h', import.meta.url),
  'utf8',
);
const authPolicySource = readFileSync(
  new URL('../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('auth navigation stability policy is compiled after the base event policy', () => {
  const eventsAt = cmakeSource.indexOf('src/sh_webview_event_policy.h');
  const finalResourceAt = cmakeSource.indexOf(
    'src/sh_runtime_resource_filter_policy_fix.h',
  );
  assert.ok(eventsAt >= 0 && eventsAt < finalResourceAt);
  assert.match(
    finalResourcePolicySource,
    /#include "sh_auth_navigation_policy_fix\.h"/,
  );
  assert.match(
    eventPolicySource,
    /#define add_NavigationCompleted\(handler, token\)[\s\S]*WrapStationheadNavigationCompletedHandler/,
  );
  assert.match(
    authPolicySource,
    /#undef add_NavigationCompleted[\s\S]*#define add_NavigationCompleted\(handler, token\)[\s\S]*WrapStationheadAuthStableNavigationCompletedHandler/,
  );
  assert.equal(
    webviewSource.split('add_NavigationCompleted(').length - 1,
    2,
    'playback and auth completion handlers must both remain behind the final policy',
  );
});

test('only superseded auth-shaped OAuth redirects are tolerated', () => {
  const wrapper = section(
    authPolicySource,
    'WrapStationheadAuthStableNavigationCompletedHandler(',
    'inline constexpr int64_t kAuthControllerStableTimeoutMs',
  );
  assert.match(wrapper, /COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED/);
  assert.doesNotMatch(wrapper, /COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED/);
  assert.match(wrapper, /IsAboutBlank\(currentSource\)/);
  assert.match(wrapper, /IsSpotifyHost\(origin\.host\)/);
  assert.match(wrapper, /IsStationheadHost\(origin\.host\)/);
  assert.match(wrapper, /if \(spotifySource\) observedSpotifyOrigin = true;/);
  assert.match(
    wrapper,
    /aboutBlank \|\| spotifySource \|\|[\s\S]*observedSpotifyOrigin && stationheadSource/,
  );
  assert.match(wrapper, /if \(authRedirectWasSuperseded\) return S_OK;/);
});

test('hard auth failures and normal completions still reach the existing handler', () => {
  const wrapper = section(
    authPolicySource,
    'WrapStationheadAuthStableNavigationCompletedHandler(',
    'inline constexpr int64_t kAuthControllerStableTimeoutMs',
  );
  const suppressAt = wrapper.indexOf(
    'if (authRedirectWasSuperseded) return S_OK;',
  );
  const invokeAt = wrapper.indexOf(
    'stationhead_webview_policy::InvokeEventNoexcept(',
  );
  assert.ok(suppressAt >= 0 && suppressAt < invokeAt);
  assert.match(wrapper, /args->get_IsSuccess\(&success\)/);
  assert.match(wrapper, /args->get_WebErrorStatus\(&webError\)/);
  assert.match(wrapper, /IsTrustedMessageUri\([\s\S]*currentSource, origin/);
});

test('auth controller creation uses the full WebView creation allowance', () => {
  assert.match(
    authPolicySource,
    /inline constexpr int64_t kAuthControllerStableTimeoutMs = 30'000;/,
  );
  assert.match(
    authPolicySource,
    /static_assert\(kAuthControllerStableTimeoutMs >=[\s\S]*kStationheadAuthControllerTimeoutMs\);/,
  );
  assert.match(
    authPolicySource,
    /static_assert\(kAuthControllerStableTimeoutMs <=[\s\S]*kStationheadWebViewCreationTimeoutMs\);/,
  );
  assert.match(
    authPolicySource,
    /#define kStationheadAuthControllerTimeoutMs[\s\S]*kAuthControllerStableTimeoutMs/,
  );
});
