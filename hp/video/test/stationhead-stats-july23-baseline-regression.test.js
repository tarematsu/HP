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

test('July 23 authentication boundary remains selected before final resource reductions', () => {
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
    /return StationheadAuthProbeScript\(channelId\);/,
  );
  assert.match(
    baselinePolicy,
    /#define StationheadApiPlayStatsScript \\\n  StationheadApiPlayStatsScriptPayloadSafe/,
  );
  assert.match(
    playbackPolicy,
    /#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe/,
  );
});

test('play stats keep page-owned auth while normalizing every supported payload shape', () => {
  assert.match(
    baselinePolicy,
    /const headers = window\.__homepanelStationheadAuthHeaders;/,
  );
  assert.match(
    baselinePolicy,
    /production1\.stationhead\.com\/me\/channel\//,
  );
  assert.match(baselinePolicy, /credentials: 'include'/);
  assert.match(
    baselinePolicy,
    /'chart_data', 'chartData', 'daily', 'history', 'points', 'values'/,
  );
  assert.match(
    baselinePolicy,
    /point\.ts \?\? point\.timestamp \?\? point\.date \?\? point\.day \?\? point\.x/,
  );
  assert.match(
    baselinePolicy,
    /point\.val \?\? point\.value \?\? point\.count \?\? point\.plays[\s\S]*point\.listens \?\? point\.y/,
  );
  assert.match(baselinePolicy, /numeric < 100000000000/);
  assert.match(baselinePolicy, /numeric > 100000000000000/);
  assert.match(
    baselinePolicy,
    /Object\.entries\(candidate\)\.map\(\(\[date, value\]\) => \(\{ date, value \}\)\)/,
  );
  assert.match(
    baselinePolicy,
    /positiveCount\(right\) - positiveCount\(left\)/,
  );
  assert.match(
    baselinePolicy,
    /data: \{ chart_data: chartData \}/,
  );
});

test('invalid payloads are retried without caching a false success', () => {
  assert.match(
    baselinePolicy,
    /if \(!chartData\.length\) \{[\s\S]*resetSuccessThrottle\(\);[\s\S]*schedulePayloadRetry\(\);/,
  );
  assert.match(
    baselinePolicy,
    /__homepanelStationheadPlayStatsPayloadRetryTimer[\s\S]*30 \* 1000/,
  );
  assert.match(
    baselinePolicy,
    /__homepanelStationheadPlayStatsAuthorization = headers\.authorization/,
  );
  assert.match(
    baselinePolicy,
    /lastSuccessAuthorization === headers\.authorization/,
  );
  assert.match(
    baselinePolicy,
    /__homepanelStationheadPlayStatsInFlight/,
  );
  assert.doesNotMatch(
    baselinePolicy,
    /stationhead-play-stats-diagnostic|response body|authorization fingerprint/i,
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
