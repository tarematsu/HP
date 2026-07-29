import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const trackBoundary = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const baselinePolicy = readFileSync(
  new URL('../../native/src/sh_stats_july23_baseline_policy_fix.h', import.meta.url),
  'utf8',
);
const playbackPolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const sharedEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

const restoredScriptNames = [
  'StationheadAuthCaptureScript',
  'StationheadApiPlayStatsScript',
  'StationheadAuthProbeScript',
];

test('July 23 statistics scripts are selected before final resource reductions', () => {
  const dataPolicyAt = trackBoundary.indexOf(
    '#include "sh_data_acquisition_resource_policy_fix.h"',
  );
  const baselineAt = trackBoundary.indexOf(
    '#include "sh_stats_july23_baseline_policy_fix.h"',
  );
  const startupAt = trackBoundary.indexOf(
    '#include "sh_startup_resource_reduction_policy_fix.h"',
  );
  const playbackAt = trackBoundary.indexOf(
    '#include "sh_playback_resource_policy_fix.h"',
  );
  assert.ok(dataPolicyAt >= 0 && dataPolicyAt < baselineAt);
  assert.ok(baselineAt < startupAt && startupAt < playbackAt);

  for (const name of restoredScriptNames) {
    assert.match(baselinePolicy, new RegExp(`#undef ${name}`));
  }
  assert.match(baselinePolicy, /return StationheadAuthCaptureScript\(\);/);
  assert.match(
    baselinePolicy,
    /return StationheadApiPlayStatsScript\(channelId\);/,
  );
  assert.match(
    baselinePolicy,
    /return StationheadAuthProbeScript\(channelId\);/,
  );
  assert.match(
    playbackPolicy,
    /#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe/,
  );
});

test('final playback controller reset clears cache without clearing login state', () => {
  assert.match(
    playbackPolicy,
    /CallDevToolsProtocolMethod\(\s*L"Network\.clearBrowserCache", L"\{\}", nullptr\);/,
  );
  assert.doesNotMatch(
    playbackPolicy,
    /ClearBrowsingDataAll|BROWSING_DATA_KINDS_COOKIES|ALL_DOM_STORAGE|DeleteAllCookies/,
  );
  assert.match(playbackPolicy, /Cookies and DOM storage remain intact/);
});

test('HTTP cache is session-local instead of permanently disabled', () => {
  assert.doesNotMatch(sharedEnvironment, /--disable-http-cache/);
  assert.match(sharedEnvironment, /--disable-features=BackForwardCache/);
  assert.match(
    sharedEnvironment,
    /HTTP[\s\S]*cache is enabled during a live controller session[\s\S]*explicitly reset/,
  );
});

test('rollback and final resource policy add no stats diagnostic channel', () => {
  assert.doesNotMatch(
    baselinePolicy + playbackPolicy,
    /stationhead-play-stats-diagnostic|response body|authorization fingerprint/i,
  );
});
