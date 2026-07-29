import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_data_acquisition_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const trackBoundary = readFileSync(
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

test('data-safe policy is compiled after the final script resource policy', () => {
  assert.match(
    trackBoundary,
    /#include "sh_data_acquisition_resource_policy_fix\.h"/,
  );
  assert.match(
    policy,
    /#include "sh_runtime_script_resource_policy_fix\.h"/,
  );
  assert.match(
    policy,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingDataSafe/,
  );
});

test('authenticated Stationhead account and statistics routes always fail open', () => {
  const boundary = section(
    policy,
    'inline constexpr bool StationheadDataAcquisitionRequestBoundaryFixed',
    '// SelectedGIF',
  );
  assert.match(boundary, /uri\.scheme != L"https"/);
  assert.match(boundary, /uri\.host != L"production1\.stationhead\.com"/);
  assert.match(boundary, /uri\.path\.starts_with\(L"\/me\/"\)/);
  assert.match(boundary, /uri\.path == L"\/account"/);
  assert.match(boundary, /uri\.path == L"\/timestamp"/);
  assert.match(boundary, /uri\.path == L"\/pusher\/presenceauth"/);
  assert.match(boundary, /uri\.path\.find\(L"\/channels\/alias\/"\)/);
  assert.match(policy, /\/me\/channel\/318\/streakstats/);
  assert.match(policy, /\/production1\.stationhead\.com\/chathistory/);
});

test('mixed SelectedGIF account module is loaded while audited decoration stubs remain', () => {
  const moduleBoundary = section(
    policy,
    'StationheadDataSafeOptionalModuleStubBoundaryFixed',
    'static_assert(StationheadDataAcquisitionRequestBoundaryFixed',
  );
  assert.match(
    moduleBoundary,
    /StationheadHashedAssetModulePathMatches\(uri\.path, L"selectedgif"\)[\s\S]*return \{\};/,
  );
  assert.match(
    moduleBoundary,
    /return StationheadKnownOptionalModuleStubBoundaryFixed\(uriLower\);/,
  );
  assert.match(policy, /selectedgif-baax9j6x\.js"\)\.empty\(\)/);
  assert.match(policy, /lottieanimationviewnonlazy-ve60c2no\.js"\)\.empty\(\)/);
  assert.match(policy, /tooltip-cxafiwy6\.js"\)\.empty\(\)/);
});

test('resource reduction remains active outside protected data routes', () => {
  const handler = section(
    policy,
    'inline void ApplyStationheadResourceBlockingDataSafe',
    '}  // namespace hp',
  );
  for (const context of [
    'IMAGE',
    'FONT',
    'MEDIA',
    'SCRIPT',
    'XML_HTTP_REQUEST',
    'FETCH',
    'TEXT_TRACK',
    'EVENT_SOURCE',
    'WEBSOCKET',
    'MANIFEST',
    'PING',
    'CSP_VIOLATION_REPORT',
  ]) {
    assert.match(
      handler,
      new RegExp(`COREWEBVIEW2_WEB_RESOURCE_CONTEXT_${context}`),
    );
  }
  assert.match(handler, /StationheadRequestIsBlockableBoundaryFixed\(lower\)/);
  assert.match(handler, /StationheadExpandedNonPlaybackScriptBoundaryFixed\(lower\)/);
  assert.match(handler, /StationheadRequestLooksLikeImage\(lower\)/);
  assert.match(handler, /StationheadCorePlaybackRequestBoundaryFixed\(lower\)/);
  assert.match(handler, /BlockStationheadTelemetrySocketsBoundaryFixed\(webview\)/);
  assert.match(handler, /emptyResource \? 204 : 403/);
});

test('protected data decision precedes every optional blocking classifier', () => {
  const handler = section(
    policy,
    'inline void ApplyStationheadResourceBlockingDataSafe',
    '}  // namespace hp',
  );
  const protectedAt = handler.indexOf(
    'StationheadDataAcquisitionRequestBoundaryFixed(lower)',
  );
  const moduleAt = handler.indexOf(
    'StationheadDataSafeOptionalModuleStubBoundaryFixed(lower)',
  );
  const socialAt = handler.indexOf(
    'StationheadRequestIsBlockableBoundaryFixed(lower)',
  );
  assert.ok(protectedAt >= 0);
  assert.ok(moduleAt > protectedAt);
  assert.ok(socialAt > protectedAt);
  assert.match(handler, /if \(!protectedData\) \{/);
});
