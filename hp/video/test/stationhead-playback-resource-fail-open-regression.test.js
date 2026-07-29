import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const composition = readFileSync(
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

test('playback-safe policy is compiled after startup reductions', () => {
  const startupAt = composition.indexOf(
    '#include "sh_startup_resource_reduction_policy_fix.h"',
  );
  const playbackAt = composition.indexOf(
    '#include "sh_playback_resource_policy_fix.h"',
  );
  const domAt = composition.indexOf(
    '#include "sh_startup_dom_batch_policy_fix.h"',
  );
  assert.ok(startupAt >= 0);
  assert.ok(playbackAt > startupAt);
  assert.ok(domAt > playbackAt);
  assert.match(
    policy,
    /#undef ApplyStationheadResourceBlocking[\s\S]*#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe/,
  );
});

test('all WebView2 MEDIA requests remain fail-open', () => {
  const filters = section(
    policy,
    'const bool blockImages = config.blockImages;',
    'ComPtr<ICoreWebView2Environment> env = environment;',
  );
  const handler = section(
    policy,
    'webview->add_WebResourceRequested(',
    'BlockStationheadTelemetrySocketsBoundaryFixed(webview);',
  );
  assert.doesNotMatch(filters, /addFilter\(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA\)/);
  assert.doesNotMatch(handler, /context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA/);
  assert.doesNotMatch(handler, /StationheadCorePlaybackRequestBoundaryFixed/);
});

test('station listener and playback controls bypass optional social blocking', () => {
  const matcher = section(
    policy,
    'inline constexpr bool StationheadPlaybackControlRequestBoundaryFixed(',
    'static_assert(StationheadPlaybackControlRequestBoundaryFixed',
  );
  assert.match(matcher, /uri\.host != L"production1\.stationhead\.com"/);
  assert.match(matcher, /uri\.path == L"\/station" \|\| uri\.path\.starts_with\(L"\/station\/"\)/);
  assert.match(matcher, /uri\.path == L"\/playback"/);
  assert.match(matcher, /uri\.path == L"\/stream"/);
  assert.match(
    policy,
    /StationheadDataAcquisitionRequestBoundaryFixed\(lower\) \|\|[\s\S]*StationheadPlaybackControlRequestBoundaryFixed\(lower\)/,
  );
  const handler = section(
    policy,
    'const bool protectedRequest =',
    'if (block) {',
  );
  assert.ok(
    handler.indexOf('StationheadPlaybackControlRequestBoundaryFixed(lower)') <
      handler.indexOf('StationheadRequestIsBlockableBoundaryFixed(lower)'),
  );
});

test('script stubs and Tooltip CSS reduction are retained', () => {
  assert.match(
    policy,
    /StationheadKnownOptionalModuleStubBoundaryFixed\(lower\)/,
  );
  assert.match(
    policy,
    /StationheadOptionalStylesheetBoundaryFixed\(lower\)/,
  );
  assert.match(policy, /replacementScript \? 200 : \(emptyResource \? 204 : 403\)/);
  assert.match(policy, /BlockStationheadTelemetrySocketsBoundaryFixed\(webview\)/);
});
