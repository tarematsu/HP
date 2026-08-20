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
  assert.doesNotMatch(policy, /StationheadOwnsWorkerRequestFilters\(webview\)/);
  assert.match(policy, /AttachStationheadNativeStats\(webview, config\.channelId\)/);
});

test('final resource boundary preserves controller cache reset without login deletion', () => {
  assert.match(
    policy,
    /CallDevToolsProtocolMethod\(\s*L"Network\.clearBrowserCache", L"\{\}", nullptr\);/,
  );
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

test('native statistics observer is read-only and never synthesizes a response', () => {
  assert.doesNotMatch(nativeStats, /add_WebResourceRequested/);
  assert.match(nativeStats, /add_WebResourceResponseReceived/);
  assert.doesNotMatch(
    nativeStats,
    /CreateWebResourceResponse|put_Response|Network\.setBlockedURLs/,
  );
});

test('all dynamic Stationhead and third-party requests remain fail-open', () => {
  const handler = section(
    policy,
    'inline void ApplyStationheadResourceBlockingPlaybackSafe',
    '}  // namespace hp',
  );
  assert.match(handler, /Do not install request substitution or CDP/);
  assert.match(handler, /synthetic response after the route shell has mounted/);
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
