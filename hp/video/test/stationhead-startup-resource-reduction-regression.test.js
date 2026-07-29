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

test('startup reduction is compiled after the data-safe policy', () => {
  const dataAt = trackBoundary.indexOf(
    '#include "sh_data_acquisition_resource_policy_fix.h"',
  );
  const startupAt = trackBoundary.indexOf(
    '#include "sh_startup_resource_reduction_policy_fix.h"',
  );
  assert.ok(dataAt >= 0);
  assert.ok(startupAt > dataAt);
  assert.match(
    policy,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingStartupReduced/,
  );
  assert.match(
    policy,
    /#undef StationheadAutoplayScript[\s\S]*#define StationheadAutoplayScript StationheadAutoplayScriptStartupReduced/,
  );
});

test('SelectedGIF is restored to the audited hash-independent module stub', () => {
  const handler = section(
    policy,
    'inline void ApplyStationheadResourceBlockingStartupReduced',
    'inline std::wstring StationheadStartupDomReductionScript',
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

test('DOM reduction is bounded, batched and protects playback and login controls', () => {
  const dom = section(
    policy,
    'inline std::wstring StationheadStartupDomReductionScript',
    'inline std::wstring StationheadAutoplayScriptStartupReduced',
  );
  for (const optionalSurface of [
    'data-testid*="gif"',
    'data-testid*="chat"',
    'data-testid*="thread"',
    'data-testid*="tipping"',
    'data-testid*="gift"',
    'data-testid*="reaction"',
    'data-testid*="emoji"',
    'data-testid*="leaderboard"',
    'data-testid*="apple-music"',
    'data-testid*="free-trial"',
  ]) {
    assert.ok(dom.toLowerCase().includes(optionalSurface));
  }
  assert.match(dom, /new MutationObserver/);
  assert.match(dom, /requestAnimationFrame/);
  assert.match(dom, /observer\.disconnect\(\)/);
  assert.match(dom, /window\.setTimeout\(stop, 15000\)/);
  assert.match(dom, /pagehide/);
  assert.match(dom, /start\\s\+listening/);
  assert.match(dom, /spotify/);
  assert.match(dom, /log\\s\*in/);
  assert.match(dom, /play\|pause\|resume\|continue\|audio\|volume/);
  assert.doesNotMatch(dom, /setInterval/);
});

test('autoplay wrapper retains all existing runtime safety policy before DOM cleanup', () => {
  const wrapper = section(
    policy,
    'inline std::wstring StationheadAutoplayScriptStartupReduced',
    '}  // namespace hp',
  );
  assert.match(
    wrapper,
    /StationheadAutoplayScriptRuntimeFixed\(globalName, messagePrefix\)/,
  );
  assert.match(wrapper, /StationheadStartupDomReductionScript\(\)/);
});
