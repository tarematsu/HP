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
const environmentHeader = readFileSync(
  new URL('../../native/src/shared_webview_environment.h', import.meta.url),
  'utf8',
);
const environmentSource = readFileSync(
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

test('Blink rejects image loading and cached image decoding before navigation', () => {
  const argumentsBuilder = section(
    environmentSource,
    'std::wstring BuildWebView2Arguments(',
    'void ApplyWebView2ProcessHints()',
  );
  assert.match(argumentsBuilder, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(argumentsBuilder, /downloadableBinaryFontsEnabled=false/);
  assert.match(
    environmentSource,
    /put_AdditionalBrowserArguments\(webView2Arguments\.c_str\(\)\)/,
  );
  assert.match(
    environmentHeader,
    /Acquire\(userDataFolder, true, true, std::move\(completion\)\)/,
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

test('optional image and font request filters follow their configuration', () => {
  assert.match(
    policySource,
    /if \(blockImages\) addFilter\(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE\);/,
  );
  assert.match(
    policySource,
    /if \(blockFonts\) addFilter\(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT\);/,
  );
  assert.match(policySource, /\[env, blockImages, blockFonts\]/);
});

test('source-aware filters cover all current request sources without duplicate worker callbacks', () => {
  const filterHelper = section(
    policySource,
    'inline void AddStationheadResourceFilter(',
    '// Blink disables image loading',
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
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_DOCUMENT/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SHARED_WORKER/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_SERVICE_WORKER/);
  assert.match(policy, /StationheadOwnsWorkerRequestFilters\(webview\)/);
  assert.doesNotMatch(policy, /COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL/);
  assert.match(policy, /AddStationheadResourceFilter\([\s\S]*sourceKinds/);
});

test('only Primary owns environment-wide worker filters', () => {
  const owner = section(
    policySource,
    'inline bool StationheadOwnsWorkerRequestFilters(',
    'inline void AddStationheadResourceFilter(',
  );
  assert.match(owner, /ICoreWebView2_13/);
  assert.match(owner, /get_Profile\(&profile\)/);
  assert.match(owner, /get_ProfileName\(&profileNameRaw\)/);
  assert.match(owner, /_wcsicmp\(profileNameRaw, L"Default"\) == 0/);
  assert.match(policySource, /requires those source filters on one CoreWebView per environment/);
});

test('resource reduction never relies on DOM scans or post-load hiding', () => {
  assert.doesNotMatch(
    policySource,
    /MutationObserver|querySelectorAll|createElement\(['"]style|display\s*:\s*none/,
  );
  assert.match(policySource, /No DOM scan[\s\S]*pays the resource cost first/);
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
