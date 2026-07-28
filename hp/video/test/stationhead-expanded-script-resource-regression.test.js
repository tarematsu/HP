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

test('optional JavaScript is classified by exact host and request path', () => {
  const classifier = section(
    policySource,
    'inline constexpr bool StationheadExpandedNonPlaybackScriptBoundaryFixed(',
    'static_assert(StationheadExpandedNonPlaybackScriptBoundaryFixed(',
  );
  assert.match(classifier, /StationheadParseRuntimeUri\(uriLower\)/);
  assert.match(classifier, /StationheadRuntimeHostMatches\(uri\.host, domain\)/);
  assert.match(classifier, /StationheadRuntimeHostMatches\(uri\.host, L"stationhead\.com"\)/);
  assert.match(classifier, /uri\.path\.ends_with\(L"\.js"\)/);
  assert.match(classifier, /uri\.path\.ends_with\(L"\.mjs"\)/);
  assert.doesNotMatch(classifier, /uriLower\.find\(needle\)/);
});

test('playback, authentication and framework bundles win over optional tokens', () => {
  assert.match(policySource, /kProtectedScriptNeedles/);
  for (const token of [
    'player', 'playback', 'audio', 'queue', 'realtime', 'pusher',
    'auth', 'login', 'session', 'spotify', 'station', 'channel',
    'runtime', 'framework', 'webpack', 'polyfill',
  ]) {
    assert.match(policySource, new RegExp(`L"${token}"`));
  }
  const protectedAt = policySource.indexOf('kProtectedScriptNeedles');
  const optionalAt = policySource.indexOf('kNonPlaybackScriptNeedles');
  assert.ok(protectedAt >= 0 && protectedAt < optionalAt);
});

test('more social, commerce, support and third-party SDK scripts are rejected', () => {
  for (const token of [
    'creator-tools', 'moderator-tools', 'subscription-modal', 'billing-modal',
    'checkout-modal', 'merch-store', 'help-center', 'support-widget',
    'privacy-policy', 'terms-of-service', 'download-app', 'streak-modal',
  ]) {
    assert.match(policySource, new RegExp(`L"${token}"`));
  }
  for (const domain of [
    'posthog.com', 'heapanalytics.com', 'logrocket.com', 'smartlook.com',
    'pendo.io', 'appcues.com', 'onetrust.com', 'cookielaw.org',
    'zdassets.com', 'zendesk.com', 'hs-scripts.com', 'mouseflow.com',
  ]) {
    assert.match(policySource, new RegExp(`L"${domain.replaceAll('.', '\\.') }"`));
  }
});

test('script blocking happens before download without DOM or duplicate handlers', () => {
  const policy = section(
    policySource,
    'inline void ApplyStationheadResourceBlockingScriptFixed(',
    '}  // namespace hp',
  );
  assert.equal((policy.match(/add_WebResourceRequested\(/g) || []).length, 1);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.match(policy, /StationheadExpandedNonPlaybackScriptBoundaryFixed\(lower\)/);
  assert.match(policy, /emptyScript \? 200 : 403/);
  assert.match(policy, /Content-Type: application\/javascript/);
  assert.match(policy, /Cache-Control: no-store/);
  assert.doesNotMatch(policy, /MutationObserver|querySelector|createElement|display:none|ExecuteScript/);
});
