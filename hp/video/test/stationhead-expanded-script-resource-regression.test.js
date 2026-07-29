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

test('same-origin optional modules use anchored hash-independent asset names', () => {
  const matcher = section(
    policySource,
    'inline constexpr bool StationheadHashedAssetModulePathMatches(',
    '// Empty-success responses are safe only',
  );
  assert.match(matcher, /kAssetsPrefix = L"\/assets\/"/);
  assert.match(matcher, /filename\.starts_with\(stem\)/);
  assert.match(matcher, /suffix\.front\(\) != L'-'/);
  assert.match(matcher, /suffix\.ends_with\(L"\.mjs"\)/);
  assert.match(matcher, /suffix\.ends_with\(L"\.js"\)/);
  assert.match(matcher, /extensionAt <= 6/);
  assert.match(matcher, /character == L'-' \|\| character == L'_'/);
  assert.doesNotMatch(matcher, /path\.find\(stem\)/);

  for (const stem of ['lottieanimationviewnonlazy', 'tooltip', 'selectedgif']) {
    assert.match(policySource, new RegExp(`uri\\.path, L"${stem}"`));
  }
  assert.match(policySource, /tooltip-different9\.js"\) ==[\s\S]*kTooltipModuleStub/);
  assert.match(policySource, /selectedgif-next1234\.mjs"\) ==[\s\S]*kSelectedGifModuleStub/);
  assert.match(policySource, /assets\/tooltip\.js"\)\.empty\(\)/);
  assert.match(policySource, /nested\/assets\/tooltip-cxafiwy6\.js"\)\.empty\(\)/);
});

test('Lottie and Tooltip are replaced by contract-compatible stubs for every hash', () => {
  assert.match(
    policySource,
    /kLottieModuleStub =[\s\S]*export const LottieAnimationViewNonLazy=\(\)=>null;/,
  );
  assert.match(
    policySource,
    /kTooltipModuleStub =[\s\S]*export const T=\(\{children\}\)=>children\?\?null;/,
  );
  assert.match(
    policySource,
    /StationheadHashedAssetModulePathMatches\(uri\.path, L"tooltip"\)[\s\S]*return kTooltipModuleStub/,
  );
  assert.doesNotMatch(policySource, /kKnownExactTooltipModulePaths|uri\.path == path/);
});

test('SelectedGIF is replaced by the audited mixed-export compatibility stub', () => {
  const stub = section(
    policySource,
    'inline constexpr std::string_view kSelectedGifModuleStub',
    '// Match only a top-level Vite asset',
  );
  assert.match(stub, /Symbol\.for\('react\.forward_ref'\)/);
  assert.match(stub, /render:n,modalOptions:\{\}/);
  assert.match(stub, /c=24/);
  for (const name of ['A', 'E', 'G', 'P', 'S', 'T', 'a', 'b', 'd', 'e', 'g']) {
    assert.match(stub, new RegExp(`v as ${name}(?:,|})`));
  }
  for (const name of ['c', 'f', 'h', 'u']) {
    assert.match(stub, new RegExp(`n as ${name}(?:,|})`));
  }
  assert.match(stub, /c as C/);
  assert.match(
    policySource,
    /StationheadHashedAssetModulePathMatches\(uri\.path, L"selectedgif"\)[\s\S]*return kSelectedGifModuleStub/,
  );
});

test('script replacement lowercases the URI and short-circuits after a module stub match', () => {
  const policy = section(
    policySource,
    'inline void ApplyStationheadResourceBlockingScriptFixed(',
    '}  // namespace hp',
  );
  assert.match(policy, /lower = StationheadLowerAscii\(uriRaw\)/);
  assert.match(policy, /StationheadKnownOptionalModuleStubBoundaryFixed\(lower\)/);
  assert.match(
    policy,
    /if \(!moduleStub\.empty\(\)\) \{[\s\S]*block = true;[\s\S]*\} else \{[\s\S]*StationheadExpandedNonPlaybackScriptBoundaryFixed\(lower\)/,
  );
});

test('all removable resources are stopped before download with minimal cacheable responses', () => {
  const policy = section(
    policySource,
    'inline void ApplyStationheadResourceBlockingScriptFixed(',
    '}  // namespace hp',
  );
  assert.equal((policy.match(/add_WebResourceRequested\(/g) || []).length, 1);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
  assert.match(policy, /emptyResource = true/);
  assert.match(policy, /SHCreateMemStream\(/);
  assert.match(policy, /responseBody\.Get\(\)/);
  assert.match(policy, /replacementScript \? 200 : \(emptyResource \? 204 : 403\)/);
  assert.match(policy, /Content-Type: application\/javascript/);
  assert.match(policy, /Content-Length: 0/);
  assert.match(policy, /Cache-Control: public, max-age=31536000, immutable/);
  assert.doesNotMatch(policy, /Cache-Control: no-store/);
  assert.doesNotMatch(policy, /MutationObserver|querySelector|createElement|display:none|ExecuteScript/);
});
