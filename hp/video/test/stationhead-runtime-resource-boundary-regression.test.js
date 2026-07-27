import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const boundarySource = readFileSync(
  new URL('../../native/src/sh_runtime_resource_boundary_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('strict resource boundary policy is the final Stationhead PCH layer', () => {
  const oldPolicyAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_resource_policy_fix.h)',
  );
  const boundaryAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_resource_boundary_policy_fix.h)',
  );
  assert.ok(oldPolicyAt >= 0 && oldPolicyAt < boundaryAt);
  assert.match(
    boundarySource,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingBoundaryFixed/,
  );
});

test('resource classification separates authority, path, query, and fragment', () => {
  const parser = section(
    boundarySource,
    'inline constexpr StationheadRuntimeUriParts StationheadParseRuntimeUri(',
    'inline constexpr bool StationheadRuntimeHostMatches(',
  );
  assert.match(parser, /uriLower\.find\(L":\/\/"\)/);
  assert.match(parser, /authority\.find\(L'@'\)/);
  assert.match(parser, /uriLower\.find_first_of\(L"\?#", authorityEnd\)/);
  assert.match(parser, /return \{true, scheme, authority, path\};/);
});

test('telemetry blocking matches destination hosts instead of arbitrary query text', () => {
  const telemetry = section(
    boundarySource,
    'inline constexpr bool StationheadTelemetryRequestBoundaryFixed(',
    'inline constexpr bool StationheadSocialApiRequestBoundaryFixed(',
  );
  assert.match(telemetry, /StationheadRuntimeHostMatches\(uri\.host, domain\)/);
  assert.match(telemetry, /uri\.path\.starts_with\(L"\/tr"\)/);
  assert.match(telemetry, /uri\.path\.starts_with\(L"\/i\/"\)/);
  assert.doesNotMatch(telemetry, /uriLower\.find\(needle\)/);

  assert.match(
    boundarySource,
    /!StationheadRequestIsBlockableBoundaryFixed\([\s\S]*production1\.stationhead\.com\/timestamp\?next=https:\/\/sentry\.io/,
  );
});

test('Stationhead social API blocking cannot leak onto media CDN paths', () => {
  const social = section(
    boundarySource,
    'inline constexpr bool StationheadSocialApiRequestBoundaryFixed(',
    'inline constexpr bool StationheadRequestIsBlockableBoundaryFixed(',
  );
  assert.match(social, /uri\.host != L"production1\.stationhead\.com"/);
  assert.match(social, /uri\.path\.find\(needle\)/);
  assert.match(
    boundarySource,
    /!StationheadRequestIsBlockableBoundaryFixed\([\s\S]*p\.scdn\.co\/audio\/chathistory-track\.mp3/,
  );
});

test('media allowlisting requires a parsed HTTPS destination host', () => {
  const playback = section(
    boundarySource,
    'inline constexpr bool StationheadCorePlaybackRequestBoundaryFixed(',
    'static_assert(StationheadRequestIsBlockableBoundaryFixed(',
  );
  assert.match(playback, /!uri\.valid \|\| uri\.scheme != L"https"/);
  assert.match(playback, /uri\.host == L"realtime-production\.stationhead\.com"/);
  assert.match(playback, /StationheadRuntimeHostMatches\(uri\.host, L"scdn\.co"\)/);
  assert.match(playback, /StationheadRuntimeHostMatches\(uri\.host, L"stationhead\.com"\)/);
  assert.match(
    boundarySource,
    /!StationheadCorePlaybackRequestBoundaryFixed\([\s\S]*stationhead\.com\.evil\.example\/timestamp/,
  );
});

test('CDP blocking is destination-host-only and never applies image suffixes globally', () => {
  const sockets = section(
    boundarySource,
    'inline void BlockStationheadTelemetrySocketsBoundaryFixed(',
    '// Last resource boundary.',
  );
  assert.match(sockets, /const auto appendDomain =/);
  assert.match(sockets, /blockedUrls \+= L"\\"\*:\/\/"/);
  assert.match(sockets, /blockedUrls \+= L"\/\*\\",\\"\*:\/\/\*\."/);
  assert.doesNotMatch(sockets, /\.png|\.jpg|\.jpeg|\.webp|\/avatar|\/artwork|\/thumbnail/);
  assert.doesNotMatch(sockets, /blockImages/);
});

test('final resource callback consolidates strict, script, and playback predicates', () => {
  const finalPolicy = section(
    boundarySource,
    'inline void ApplyStationheadResourceBlockingBoundaryFixed(',
    '}  // namespace hp',
  );
  assert.equal(
    (finalPolicy.match(/add_WebResourceRequested\(/g) || []).length,
    1,
  );
  assert.match(finalPolicy, /StationheadRequestIsBlockableBoundaryFixed\(lower\)/);
  assert.match(finalPolicy, /StationheadNonPlaybackScriptUrlRuntimeFixed\(lower\)/);
  assert.match(finalPolicy, /StationheadAdditionalNonPlaybackScriptUrl\(lower\)/);
  assert.match(finalPolicy, /StationheadCorePlaybackRequestBoundaryFixed\(lower\)/);
  assert.doesNotMatch(finalPolicy, /ApplyStationheadNonPlaybackScriptBlockingRuntimeFixed/);
  assert.doesNotMatch(finalPolicy, /ApplyStationheadAdditionalScriptBlockingRuntimeFixed/);
  assert.doesNotMatch(finalPolicy, /StationheadRequestIsBlockable\(lower\)/);
  assert.doesNotMatch(finalPolicy, /StationheadCorePlaybackRequest\(lower\)/);
  assert.match(finalPolicy, /\[env, blockImages, blockFonts\]/);
  assert.doesNotMatch(finalPolicy, /&armed/);
  assert.match(finalPolicy, /BlockStationheadTelemetrySocketsBoundaryFixed\(webview\)/);
  assert.doesNotMatch(finalPolicy, /BlockStationheadTelemetrySockets\(webview,/);
});
