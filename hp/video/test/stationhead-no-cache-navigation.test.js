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
const recoveryPolicy = readFileSync(
  new URL('../../native/src/sh_track_boundary_message_policy.h', import.meta.url),
  'utf8',
);
const trackBoundaryScript = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const july19Policy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url),
  'utf8',
);

test('Stationhead keeps the HTTP cache and uses shared UDF image/font suppression', () => {
  assert.doesNotMatch(environment, /--disable-http-cache/);
  assert.match(environment, /--disable-features=BackForwardCache,/);
  assert.match(environment, /kStationheadWebView2Arguments/);
  assert.match(environment, /BuildWebView2Arguments\([\s\S]*CreateCoreWebView2EnvironmentWithOptions/);
  assert.match(environment, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(environment, /downloadableBinaryFontsEnabled=false/);
  assert.match(
    environment,
    /put_AdditionalBrowserArguments\(webView2Arguments\.c_str\(\)\)/,
  );
  assert.doesNotMatch(environment, /WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS/);
  assert.doesNotMatch(july19Policy, /Network\.clearBrowserCache|clearBrowserCache/);
  assert.doesNotMatch(
    july19Policy,
    /AddWebResourceRequestedFilter|add_WebResourceRequested|Network\.setBlockedURLs/,
  );
  assert.match(player, /NavigateCurrentUrl\(UnixMillis\(\), L"startup"\)/);
});

test('long-lived Stationhead room has no preventive navigation clock', () => {
  assert.doesNotMatch(recoveryPolicy, /StationheadPeriodicRefreshIntervalMs/);
  assert.doesNotMatch(recoveryPolicy, /RefreshPeriodicNavigation/);
  assert.doesNotMatch(recoveryPolicy, /50-minute periodic refresh/);
  assert.match(recoveryPolicy, /StationheadAudioHealthCheckIntervalMs/);
  assert.match(recoveryPolicy, /return 1 \* 60'000/);
  assert.match(recoveryPolicy, /StationheadAudioRecoveryStage/);
  assert.doesNotMatch(recoveryPolicy, /53-minute|54-minute|56-minute/);
  assert.doesNotMatch(recoveryPolicy, /StationheadClockSwitch|even-minute|odd-minute/);

  const boundaryStart = trackBoundaryScript.indexOf(
    'inline std::wstring StationheadTrackBoundaryScript(',
  );
  const boundaryEnd = trackBoundaryScript.indexOf('}  // namespace hp', boundaryStart);
  assert.ok(boundaryStart >= 0 && boundaryEnd > boundaryStart);
  const boundary = trackBoundaryScript.slice(boundaryStart, boundaryEnd);
  assert.match(boundary, /return L"void 0;"/);
  assert.doesNotMatch(boundary, /track-boundary-retry|track-ended|timeupdate/);
  assert.doesNotMatch(boundary, /NavigateCurrentUrl\(|ScheduleRecreate\(|location\.reload/);

  assert.equal(environment.match(/BackForwardCache/g)?.length, 1,
    'the shared Stationhead environment should have one page-state cache policy');
});

test('cache retention does not replace or erase the persistent Stationhead login profile', () => {
  const combined = environment + july19Policy;
  assert.doesNotMatch(environment, /--incognito|--guest|--user-data-dir/);
  assert.doesNotMatch(
    combined,
    /ClearBrowsingDataAll|BROWSING_DATA_KINDS_COOKIES|ALL_SITE|ALL_PROFILE|LOCAL_STORAGE|ALL_DOM_STORAGE|DeleteAllCookies|clearBrowserCache/,
  );
});
