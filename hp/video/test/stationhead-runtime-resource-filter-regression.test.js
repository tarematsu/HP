import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const policySource = readFileSync(
  new URL('../../native/src/sh_runtime_resource_filter_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('resource filter reduction is the final resource PCH layer', () => {
  assert.match(
    cmakeSource,
    /set\(HOMEPANEL_STATIONHEAD_SOURCES[\s\S]*src\/sh_runtime_resource_boundary_policy_fix\.h[\s\S]*src\/sh_runtime_resource_filter_policy_fix\.h[\s\S]*src\/sh_track_boundary_message_policy\.h/,
  );
  const boundaryAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_resource_boundary_policy_fix.h)',
  );
  const filterAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_resource_filter_policy_fix.h)',
  );
  const boundaryMessageAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_track_boundary_message_policy.h)',
  );
  assert.ok(boundaryAt >= 0 && boundaryAt < filterAt);
  assert.ok(filterAt < boundaryMessageAt);
  assert.match(
    policySource,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingFilterFixed/,
  );
});

test('unused stylesheet callbacks are not registered', () => {
  const policy = section(
    policySource,
    'inline void ApplyStationheadResourceBlockingFilterFixed(',
    '}  // namespace hp',
  );
  assert.doesNotMatch(
    policy,
    /addFilter\([\s\S]{0,80}COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET/,
  );
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH/);
});

test('optional image and font filters follow their configuration', () => {
  assert.match(
    policySource,
    /if \(blockImages\) \{[\s\S]*addFilter\(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE\);[\s\S]*\}/,
  );
  assert.match(
    policySource,
    /if \(blockFonts\) \{[\s\S]*addFilter\(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT\);[\s\S]*\}/,
  );
  assert.match(policySource, /\[env, blockImages, blockFonts\]/);
});

test('source-aware filters cover every current request source on both players', () => {
  const filterHelper = section(
    policySource,
    'inline void AddStationheadResourceFilter(',
    '// The strict resource boundary',
  );
  assert.match(filterHelper, /ICoreWebView2_22\* sourceAwareWebView/);
  assert.match(
    filterHelper,
    /AddWebResourceRequestedFilterWithRequestSourceKinds\([\s\S]*sourceKinds/,
  );
  assert.match(
    filterHelper,
    /if \(FAILED\(result\) && webview\) \{[\s\S]*AddWebResourceRequestedFilter\(L"\*", context\);/,
  );

  const policy = section(
    policySource,
    'inline void ApplyStationheadResourceBlockingFilterFixed(',
    'ComPtr<ICoreWebView2Environment> env = environment;',
  );
  assert.match(policy, /ComPtr<ICoreWebView2_22> sourceAwareWebView/);
  assert.match(
    policy,
    /COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT[\s\S]*COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SHARED_WORKER[\s\S]*COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SERVICE_WORKER/,
  );
  assert.doesNotMatch(
    policy,
    /COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL/,
  );
  assert.doesNotMatch(policy, /get_Profile|get_ProfileName|stationhead-secondary/);
  assert.match(policy, /AddStationheadResourceFilter\([\s\S]*sourceKinds/);
});

test('worker coverage does not depend on a fixed primary owner', () => {
  assert.doesNotMatch(
    policySource,
    /StationheadOwnsEnvironmentWorkerFilters|ownsWorkerFilters|L"Default"/,
  );
  assert.match(
    policySource,
    /Register the complete current source mask on both playback WebViews/,
  );
  assert.match(
    policySource,
    /Secondary keeps worker blocking active instead of depending on a fixed owner/,
  );
});

test('ping requests are rejected without URI allocation', () => {
  const contextGate = section(
    policySource,
    'if (hasContext) {',
    'if (needsUri) {',
  );
  assert.match(
    contextGate,
    /context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING[\s\S]*block = true;[\s\S]*needsUri = false;/,
  );
  assert.doesNotMatch(contextGate, /get_Request|get_Uri|StationheadLowerAscii/);
});

test('strict playback and blocking predicates remain consolidated', () => {
  const policy = section(
    policySource,
    'inline void ApplyStationheadResourceBlockingFilterFixed(',
    '}  // namespace hp',
  );
  assert.equal((policy.match(/add_WebResourceRequested\(/g) || []).length, 1);
  assert.match(policy, /StationheadRequestIsBlockableBoundaryFixed\(lower\)/);
  assert.match(policy, /StationheadNonPlaybackScriptUrlRuntimeFixed\(lower\)/);
  assert.match(policy, /StationheadAdditionalNonPlaybackScriptUrl\(lower\)/);
  assert.match(policy, /StationheadRequestLooksLikeImage\(lower\)/);
  assert.match(policy, /StationheadCorePlaybackRequestBoundaryFixed\(lower\)/);
  assert.match(policy, /BlockStationheadTelemetrySocketsBoundaryFixed\(webview\)/);
});
