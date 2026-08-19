import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const nativeStats = readFileSync(
  new URL('../../native/src/stationhead_native_stats.cpp', import.meta.url),
  'utf8',
);
const sharedEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);
const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('playback-safe policy remains the final request boundary', () => {
  const acquisitionAt = composition.indexOf(
    '#include "sh_data_acquisition_resource_policy_fix.h"',
  );
  const startupAt = composition.indexOf(
    '#include "sh_startup_resource_reduction_policy_fix.h"',
  );
  const playbackAt = composition.indexOf(
    '#include "sh_playback_resource_policy_fix.h"',
  );
  assert.ok(acquisitionAt >= 0);
  assert.ok(startupAt > acquisitionAt);
  assert.ok(playbackAt > startupAt);
  assert.doesNotMatch(composition, /sh_stats_|sh_startup_dom_batch_policy_fix\.h/);
  assert.match(
    policy,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe/,
  );
  assert.match(policy, /#include "stationhead_native_stats\.h"/);
  assert.match(policy, /AttachStationheadNativeStats\(webview, config\.channelId\)/);
});

test('playback-safe policy is the final precompiled Stationhead policy for every translation unit', () => {
  const scriptPolicyAt = cmake.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_script_resource_policy_fix.h)',
  );
  const playbackPolicyAt = cmake.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_playback_resource_policy_fix.h)',
  );
  const messagePolicyAt = cmake.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_track_boundary_message_policy.h)',
  );
  assert.ok(scriptPolicyAt >= 0);
  assert.ok(playbackPolicyAt > scriptPolicyAt);
  assert.ok(messagePolicyAt > playbackPolicyAt);
  assert.match(
    policy,
    /#undef kStationheadDailyPlayStatsIntervalMs[\s\S]*kStationheadLegacyStatsPollDisabledIntervalMs/,
  );
});

test('document-start auth slot settles login UI without patching Stationhead fetch or XHR', () => {
  const settlement = section(
    composition,
    'inline std::wstring StationheadLoginSettlementScript()',
    '// Media boundaries never initiate navigation.',
  );
  assert.match(settlement, /stationhead-auth-ready/);
  assert.doesNotMatch(settlement, /window\.fetch|XMLHttpRequest|Authorization|authorization/);
  assert.match(
    composition,
    /#undef StationheadAuthCaptureScript\s*#define StationheadAuthCaptureScript StationheadLoginSettlementScript/,
  );
});

test('final resource boundary preserves controller cache reset without login deletion', () => {
  assert.match(
    policy,
    /CallDevToolsProtocolMethod\(\s*L"Network\.clearBrowserCache", L"\{\}", nullptr\);/,
  );
  assert.doesNotMatch(policy, /Network\.enable/);
  assert.match(policy, /Cookies and DOM storage remain intact/);
  assert.doesNotMatch(
    policy,
    /ClearBrowsingDataAll|BROWSING_DATA_KINDS_COOKIES|ALL_DOM_STORAGE|DeleteAllCookies/,
  );
});

test('playback policy installs no request substitution or URL blocking', () => {
  const handler = section(
    policy,
    'inline void ApplyStationheadResourceBlockingPlaybackSafe',
    '}  // namespace hp',
  );
  assert.doesNotMatch(
    handler,
    /AddWebResourceRequestedFilter|AddStationheadResourceFilter|add_WebResourceRequested/,
  );
  assert.doesNotMatch(
    handler,
    /Network\.setBlockedURLs|BlockStationheadTelemetrySockets/,
  );
  assert.doesNotMatch(
    handler,
    /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_|CreateWebResourceResponse|put_Response/,
  );
});

test('native statistics observes final headers without mutating browser traffic', () => {
  assert.match(nativeStats, /GetDevToolsProtocolEventReceiver/);
  assert.match(nativeStats, /Network\.responseReceived/);
  assert.match(nativeStats, /get_ParameterObjectAsJson/);
  assert.match(nativeStats, /WinHttpDownload/);
  assert.doesNotMatch(nativeStats, /WebResourceRequested|WebResourceResponseReceived/);
  assert.doesNotMatch(nativeStats, /Network\.requestWillBeSent|Network\.loadingFinished|Network\.getResponseBody/);
  assert.doesNotMatch(nativeStats, /requestId|PendingRequest/);
  assert.doesNotMatch(
    nativeStats,
    /CreateWebResourceResponse|put_Response|Network\.setBlockedURLs|Network\.setExtraHTTPHeaders|Network\.setCacheDisabled/,
  );
});

test('all dynamic Stationhead and third-party requests remain fail-open', () => {
  const handler = section(
    policy,
    'inline void ApplyStationheadResourceBlockingPlaybackSafe',
    '}  // namespace hp',
  );
  assert.match(handler, /Do not block or synthesize dynamic requests/);
  assert.doesNotMatch(
    handler,
    /StationheadRequestIsBlockable|StationheadTelemetryRequest|StationheadExpandedNonPlaybackScript|StationheadKnownOptionalModuleStub|StationheadOptionalStylesheet/,
  );
});

test('safe image and font reduction remains environment-level', () => {
  assert.match(sharedEnvironment, /std::wstring BuildWebView2Arguments\(bool blockImages, bool blockFonts\)/);
  assert.match(sharedEnvironment, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(sharedEnvironment, /downloadableBinaryFontsEnabled=false/);
  assert.match(
    sharedEnvironment,
    /put_AdditionalBrowserArguments\(webView2Arguments\.c_str\(\)\)/,
  );
});
