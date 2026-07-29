import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_startup_resource_reduction_policy_fix.h', import.meta.url),
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

test('startup resource and playback policies are compiled without DOM reduction', () => {
  const dataAt = trackBoundary.indexOf(
    '#include "sh_data_acquisition_resource_policy_fix.h"',
  );
  const startupAt = trackBoundary.indexOf(
    '#include "sh_startup_resource_reduction_policy_fix.h"',
  );
  const playbackAt = trackBoundary.indexOf(
    '#include "sh_playback_resource_policy_fix.h"',
  );
  assert.ok(dataAt >= 0);
  assert.ok(startupAt > dataAt);
  assert.ok(playbackAt > startupAt);
  assert.doesNotMatch(trackBoundary, /sh_startup_dom_batch_policy_fix\.h/);
  assert.match(
    policy,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingStartupReduced/,
  );
});

test('startup DOM mutation is absent from the compiled policy', () => {
  assert.doesNotMatch(policy, /StationheadStartupDomReductionScript/);
  assert.doesNotMatch(policy, /StationheadStartupDomBatchFixedScript/);
  assert.doesNotMatch(policy, /MutationObserver/);
  assert.doesNotMatch(policy, /requestAnimationFrame/);
  assert.doesNotMatch(policy, /element\.remove\(\)/);
  assert.doesNotMatch(policy, /__homepanelStationheadStartupDomReduction/);
  assert.doesNotMatch(policy, /#define StationheadAutoplayScript/);
});

test('SelectedGIF remains the audited hash-independent module stub', () => {
  const handler = section(
    policy,
    'inline void ApplyStationheadResourceBlockingStartupReduced',
    '}  // namespace hp',
  );
  assert.match(
    handler,
    /moduleStub\s*=\s*StationheadKnownOptionalModuleStubBoundaryFixed\(lower\)/,
  );
  assert.doesNotMatch(
    handler,
    /StationheadDataSafeOptionalModuleStubBoundaryFixed\(lower\)/,
  );
  const protectedAt = handler.indexOf(
    'StationheadDataAcquisitionRequestBoundaryFixed(lower)',
  );
  const moduleAt = handler.indexOf(
    'StationheadKnownOptionalModuleStubBoundaryFixed(lower)',
  );
  assert.ok(protectedAt >= 0);
  assert.ok(moduleAt > protectedAt);
});

test('only the exact optional Tooltip stylesheet is replaced with local 204', () => {
  const matcher = section(
    policy,
    'inline constexpr bool StationheadOptionalStylesheetBoundaryFixed',
    'static_assert(StationheadOptionalStylesheetBoundaryFixed',
  );
  assert.match(matcher, /uri\.scheme != L"https"/);
  assert.match(matcher, /StationheadRuntimeHostMatches\(uri\.host, L"stationhead\.com"\)/);
  assert.match(matcher, /L"\/assets\/tooltip-"/);
  assert.match(matcher, /L"\.css"/);
  assert.match(matcher, /hash\.size\(\) < 6/);
  assert.match(policy, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET/);
  assert.match(
    policy,
    /StationheadOptionalStylesheetBoundaryFixed\(lower\)[\s\S]*emptyResource = block/,
  );
  assert.match(policy, /emptyResource \? 204 : 403/);
  assert.match(policy, /stationhead\.com\.evil\.example\/assets\/tooltip-u7w9wxcq\.css/);
});
