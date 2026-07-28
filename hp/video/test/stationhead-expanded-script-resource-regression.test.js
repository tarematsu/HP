import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const policySource = readFileSync(
  new URL('../../native/src/sh_runtime_script_resource_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('expanded script policy is the final Stationhead resource layer', () => {
  assert.match(
    cmakeSource,
    /src\/sh_runtime_resource_filter_policy_fix\.h[\s\S]*src\/sh_runtime_script_resource_policy_fix\.h[\s\S]*src\/sh_track_boundary_message_policy\.h/,
  );
  const filterAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_resource_filter_policy_fix.h)',
  );
  const scriptAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_script_resource_policy_fix.h)',
  );
  const boundaryMessageAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_track_boundary_message_policy.h)',
  );
  assert.ok(filterAt >= 0 && filterAt < scriptAt && scriptAt < boundaryMessageAt);
  assert.match(
    policySource,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingScriptFixed/,
  );
});

test('generic empty-script replacement is restricted to exact third-party hosts', () => {
  const classifier = section(
    policySource,
    'inline constexpr bool StationheadExpandedNonPlaybackScriptBoundaryFixed(',
    'inline constexpr std::string_view StationheadKnownOptionalModuleStubBoundaryFixed(',
  );
  assert.match(classifier, /StationheadParseRuntimeUri\(uriLower\)/);
  assert.match(classifier, /StationheadRuntimeHostMatches\(uri\.host, domain\)/);
  assert.doesNotMatch(classifier, /uri\.path\.find\(needle\)/);
  for (const domain of [
    'posthog.com', 'heapanalytics.com', 'logrocket.com', 'smartlook.com',
    'pendo.io', 'appcues.com', 'onetrust.com', 'cookielaw.org',
    'zdassets.com', 'zendesk.com', 'hs-scripts.com', 'mouseflow.com',
    'appleid.cdn-apple.com', 'accounts.google.com',
  ]) {
    assert.match(policySource, new RegExp(`L"${domain.replaceAll('.', '\\.') }"`));
  }
});

test('live-observed same-origin ESM modules are never replaced with an empty module', () => {
  for (const filename of [
    'SelectedGIF-BaAx9j6X.js',
    'premium-20-IQ2C1WIZ.js',
    'paginationHooks-DAuPuAck.js',
    'AppleMusicFreeTrialButton-BzMIl5Mx.js',
  ]) {
    assert.match(
      policySource,
      new RegExp(`!StationheadExpandedNonPlaybackScriptBoundaryFixed\\([\\s\\S]*${filename.replaceAll('.', '\\.')}`),
    );
  }
  assert.doesNotMatch(
    section(
      policySource,
      'inline constexpr bool StationheadExpandedNonPlaybackScriptBoundaryFixed(',
      'inline constexpr std::string_view StationheadKnownOptionalModuleStubBoundaryFixed(',
    ),
    /kNonPlaybackScriptNeedles|kProtectedScriptNeedles/,
  );
});

test('Lottie is replaced by a contract-compatible ES module stub', () => {
  const stub = section(
    policySource,
    'inline constexpr std::string_view StationheadKnownOptionalModuleStubBoundaryFixed(',
    'static_assert(StationheadExpandedNonPlaybackScriptBoundaryFixed(',
  );
  assert.match(stub, /kKnownOptionalModuleNeedles/);
  assert.match(policySource, /L"lottieanimationviewnonlazy"/);
  assert.match(stub, /export const LottieAnimationViewNonLazy=\(\)=>null;/);
  assert.match(stub, /StationheadRuntimeHostMatches\(uri\.host, L"stationhead\.com"\)/);
  assert.match(stub, /uri\.path\.ends_with\(L"\.js"\)/);
});

test('the live Tooltip hash is replaced by a child-preserving exact-path stub', () => {
  const stub = section(
    policySource,
    'inline constexpr std::string_view StationheadKnownOptionalModuleStubBoundaryFixed(',
    'static_assert(StationheadExpandedNonPlaybackScriptBoundaryFixed(',
  );
  assert.match(policySource, /kKnownExactTooltipModulePaths/);
  assert.match(policySource, /L"\/assets\/tooltip-cxafiwy6\.js"/);
  assert.match(stub, /uri\.path == path/);
  assert.match(stub, /export const T=\(\{children\}\)=>children\?\?null;/);
  assert.doesNotMatch(stub, /uri\.path\.find\([^)]*tooltip/i);
  assert.match(policySource, /tooltip-different\.js"\)\.empty\(\)/);
});

test('script replacement lowercases the URI before exact-path classification', () => {
  const policy = section(
    policySource,
    'inline void ApplyStationheadResourceBlockingScriptFixed(',
    '}  // namespace hp',
  );
  assert.match(policy, /lower = StationheadLowerAscii\(uriRaw\)/);
  assert.match(policy, /StationheadKnownOptionalModuleStubBoundaryFixed\(lower\)/);
});

test('script replacement happens before download with a real stub stream and one handler', () => {
  const policy = section(
    policySource,
    'inline void ApplyStationheadResourceBlockingScriptFixed(',
    '}  // namespace hp',
  );
  assert.equal((policy.match(/add_WebResourceRequested\(/g) || []).length, 1);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.match(policy, /StationheadKnownOptionalModuleStubBoundaryFixed\(lower\)/);
  assert.match(policy, /StationheadExpandedNonPlaybackScriptBoundaryFixed\(lower\)/);
  assert.match(policy, /SHCreateMemStream\(/);
  assert.match(policy, /responseBody\.Get\(\)/);
  assert.match(policy, /replacementScript \? 200 : 403/);
  assert.match(policy, /Content-Type: application\/javascript/);
  assert.match(policy, /Cache-Control: no-store/);
  assert.doesNotMatch(policy, /MutationObserver|querySelector|createElement|display:none|ExecuteScript/);
});
