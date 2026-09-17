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
  const pch = section(
    cmakeSource,
    'target_precompile_headers(HomePanel PRIVATE',
    'add_dependencies(HomePanel',
  );
  const boundaryAt = pch.indexOf('src/sh_runtime_resource_boundary_policy_fix.h');
  const filterAt = pch.indexOf('src/sh_runtime_resource_filter_policy_fix.h');
  const boundaryMessageAt = pch.indexOf('src/sh_track_boundary_message_policy.h');
  assert.ok(boundaryAt >= 0 && boundaryAt < filterAt);
  assert.ok(filterAt < boundaryMessageAt);
  assert.match(
    policySource,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingFilterFixed/,
  );
});

test('shared media environments keep autonomous playback active while occluded', () => {
  assert.match(environmentSource, /kSharedWebView2LifecycleArguments/);
  assert.match(environmentSource, /--disable-backgrounding-occluded-windows/);
  assert.match(environmentSource, /--disable-renderer-backgrounding/);
  assert.match(environmentSource, /--disable-background-timer-throttling/);
  assert.match(environmentSource, /--autoplay-policy=no-user-gesture-required/);
  const sharedStart = environmentSource.indexOf(
    'constexpr wchar_t kSharedWebView2LifecycleArguments[]',
  );
  const fullResourceStart = environmentSource.indexOf(
    'constexpr wchar_t kFullResourceWebView2Arguments[]',
  );
  const stationheadStart = environmentSource.indexOf(
    'constexpr wchar_t kStationheadWebView2Arguments[]',
  );
  assert.ok(sharedStart >= 0 && fullResourceStart > sharedStart);
  assert.ok(stationheadStart > fullResourceStart);
  const sharedArguments = environmentSource.slice(sharedStart, fullResourceStart);
  const fullResourceArguments = environmentSource.slice(fullResourceStart, stationheadStart);
  assert.match(sharedArguments, /--autoplay-policy=no-user-gesture-required/);
  assert.match(sharedArguments, /--disable-backgrounding-occluded-windows/);
  assert.match(sharedArguments, /--disable-renderer-backgrounding/);
  assert.match(sharedArguments, /--disable-background-timer-throttling/);
  assert.match(sharedArguments, /--disable-domain-reliability/);
  assert.match(sharedArguments, /--disable-breakpad/);
  assert.match(sharedArguments, /--disable-extensions/);
  assert.match(sharedArguments, /--disable-sync/);
  assert.match(fullResourceArguments, /MediaRouter/);
  assert.match(fullResourceArguments, /Translate/);
  assert.doesNotMatch(fullResourceArguments, /BackForwardCache|HardwareSecureDecryption/);
  assert.match(
    environmentSource,
    /std::wstring webView2Arguments = kSharedWebView2LifecycleArguments/,
  );
  assert.match(
    environmentSource,
    /const std::wstring resourceArguments = BuildWebView2Arguments\(/,
  );
  assert.match(
    environmentSource,
    /webView2Arguments \+= resourceArguments/,
  );
});

test('shared UDF disables images and downloadable fonts for every media profile', () => {
  const argumentsBuilder = section(
    environmentSource,
    'std::wstring BuildWebView2Arguments(',
    'void InvokeEnvironmentCompletionNoexcept(',
  );
  assert.match(
    argumentsBuilder,
    /if \(!blockImages && !blockFonts\) return kFullResourceWebView2Arguments;/,
  );
  assert.match(argumentsBuilder, /kStationheadWebView2Arguments/);
  assert.match(argumentsBuilder, /imagesEnabled=false,loadsImagesAutomatically=false/);
  assert.match(argumentsBuilder, /downloadableBinaryFontsEnabled=false/);
  assert.match(
    environmentSource,
    /blockImages = true;[\s\S]*blockFonts = true;/,
  );
  assert.match(
    environmentSource,
    /put_AdditionalBrowserArguments\(webView2Arguments\.c_str\(\)\)/,
  );
  assert.match(
    environmentHeader,
    /Acquire\(userDataFolder, true, true, std::move\(completion\)\)/,
  );
});

test('unused stylesheet and UDF-owned image/font callbacks are not registered', () => {
  const policy = section(
    policySource,
    'inline void ApplyStationheadResourceBlockingFilterFixed(',
    '}  // namespace hp',
  );
  assert.doesNotMatch(
    policy,
    /addFilter\([\s\S]{0,80}COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET/,
  );
  assert.doesNotMatch(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_(?:IMAGE|FONT)/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH/);
  assert.match(policy, /\(void\)config;/);
});

test('source-aware filters cover all current request sources without duplicate worker callbacks', () => {
  const filterHelper = section(
    policySource,
    'inline void AddStationheadResourceFilter(',
    '// Images and downloadable fonts are disabled once',
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

test('the restored amazon profile owns environment-wide worker filters', () => {
  const owner = section(
    policySource,
    'inline bool StationheadOwnsWorkerRequestFilters(',
    'inline void AddStationheadResourceFilter(',
  );
  assert.match(owner, /ICoreWebView2_13/);
  assert.match(owner, /get_Profile\(&profile\)/);
  assert.match(owner, /get_ProfileName\(&profileNameRaw\)/);
  assert.match(owner, /_wcsicmp\(profileNameRaw, L"spotify-v2-1"\) == 0/);
  assert.match(policySource, /single Stationhead instance owns the former amazon profile/);
});

test('Stationhead-specific reduction never relies on DOM scans or image/font interception', () => {
  assert.doesNotMatch(
    policySource,
    /MutationObserver|querySelectorAll|createElement\(['"]style|display\s*:\s*none/,
  );
  assert.doesNotMatch(policySource, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_(?:IMAGE|FONT)/);
  assert.match(
    policySource,
    /Images and downloadable fonts are disabled once at shared-UDF environment[\s\S]*Stationhead-specific request boundaries/,
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
  assert.doesNotMatch(policy, /StationheadRequestLooksLikeImage\(lower\)/);
  assert.match(policy, /StationheadCorePlaybackRequestBoundaryFixed\(lower\)/);
  assert.match(policy, /BlockStationheadTelemetrySocketsBoundaryFixed\(webview\)/);
});
