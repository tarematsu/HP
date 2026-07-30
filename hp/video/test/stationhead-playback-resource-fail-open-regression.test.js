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

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('playback-safe policy remains the final Stationhead resource boundary', () => {
  const baselineAt = composition.indexOf(
    '#include "sh_stats_july23_baseline_policy_fix.h"',
  );
  const startupAt = composition.indexOf(
    '#include "sh_startup_resource_reduction_policy_fix.h"',
  );
  const playbackAt = composition.indexOf(
    '#include "sh_playback_resource_policy_fix.h"',
  );
  assert.ok(baselineAt >= 0);
  assert.ok(startupAt > baselineAt);
  assert.ok(playbackAt > startupAt);
  assert.doesNotMatch(composition, /sh_startup_dom_batch_policy_fix\.h/);
  assert.match(
    policy,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe/,
  );
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

test('media and presentation resources remain outside the native request handler', () => {
  const filters = section(
    policy,
    'const auto addFilter =',
    'ComPtr<ICoreWebView2Environment> env = environment;',
  );
  const handler = section(
    policy,
    'webview->add_WebResourceRequested(',
    '}  // namespace hp',
  );
  assert.doesNotMatch(
    filters,
    /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_(?:IMAGE|FONT|STYLESHEET|MEDIA|TEXT_TRACK|MANIFEST)/,
  );
  assert.doesNotMatch(handler, /StationheadCorePlaybackRequestBoundaryFixed/);
});

test('blocking stays disarmed until native audio is stable', () => {
  const handler = section(
    policy,
    'webview->add_WebResourceRequested(',
    '}  // namespace hp',
  );
  const armedAt = handler.indexOf(
    'armedState->load(std::memory_order_acquire)',
  );
  const telemetryAt = handler.indexOf(
    'StationheadTelemetryRequestBoundaryFixed(lower)',
  );
  assert.ok(armedAt >= 0);
  assert.ok(telemetryAt > armedAt);
  assert.match(handler, /if \(!args \|\|[\s\S]*!armedState->load\(std::memory_order_acquire\)\)[\s\S]*return S_OK;/);
  assert.doesNotMatch(policy, /BlockStationheadTelemetrySocketsBoundaryFixed\(webview\)/);
});

test('all Stationhead-owned scripts, styles and APIs fail open', () => {
  const matcher = section(
    policy,
    'inline constexpr bool StationheadOwnedRequestBoundaryFixed(',
    'static_assert(StationheadOwnedRequestBoundaryFixed',
  );
  const handler = section(
    policy,
    'webview->add_WebResourceRequested(',
    '}  // namespace hp',
  );
  assert.match(matcher, /uri\.scheme == L"https"/);
  assert.match(matcher, /StationheadRuntimeHostMatches\(uri\.host, L"stationhead\.com"\)/);
  assert.match(handler, /StationheadOwnedRequestBoundaryFixed\(lower\)/);
  assert.doesNotMatch(
    handler,
    /StationheadKnownOptionalModuleStubBoundaryFixed|StationheadStartupOptionalModuleStubBoundaryFixed|StationheadOptionalStylesheetBoundaryFixed|StationheadRequestIsBlockableBoundaryFixed|StationheadExpandedNonPlaybackScriptBoundaryFixed/,
  );
  assert.match(policy, /production1\.stationhead\.com\/chathistory/);
  assert.match(policy, /realtime-production\.stationhead\.com\/app\/key/);
});

test('only explicit third-party telemetry is replaced after arming', () => {
  const handler = section(
    policy,
    'webview->add_WebResourceRequested(',
    '}  // namespace hp',
  );
  assert.match(handler, /StationheadTelemetryRequestBoundaryFixed\(lower\)/);
  assert.match(handler, /const int status = script \? 200 : 204;/);
  assert.match(handler, /Content-Type: application\/javascript; charset=utf-8/);
  assert.doesNotMatch(handler, /SHCreateMemStream|moduleStub|emptyScript|emptyResource/);
});
