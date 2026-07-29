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
const sharedEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

const restoredNames = [
  'StationheadAuthCaptureScript',
  'StationheadApiPlayStatsScript',
  'StationheadAuthProbeScript',
  'ApplyStationheadResourceBlocking',
];

test('July 23 policy is compiled after the later data and auth wrappers', () => {
  const dataPolicyAt = trackBoundary.indexOf(
    '#include "sh_data_acquisition_resource_policy_fix.h"',
  );
  const baselineAt = trackBoundary.indexOf(
    '#include "sh_stats_july23_baseline_policy_fix.h"',
  );
  assert.ok(dataPolicyAt >= 0 && dataPolicyAt < baselineAt);

  for (const name of restoredNames) {
    assert.match(baselinePolicy, new RegExp(`#undef ${name}`));
  }
  assert.match(
    baselinePolicy,
    /return StationheadAuthCaptureScript\(\);/,
  );
  assert.match(
    baselinePolicy,
    /return StationheadApiPlayStatsScript\(channelId\);/,
  );
  assert.match(
    baselinePolicy,
    /return StationheadAuthProbeScript\(channelId\);/,
  );
  assert.match(
    baselinePolicy,
    /ApplyStationheadResourceBlocking\(\s*environment, webview, config, armed, token\);/,
  );
});

test('each playback controller reset clears cache without clearing login state', () => {
  assert.match(
    baselinePolicy,
    /CallDevToolsProtocolMethod\(\s*L"Network\.clearBrowserCache", L"\{\}", nullptr\);/,
  );
  assert.doesNotMatch(
    baselinePolicy,
    /ClearBrowsingDataAll|BROWSING_DATA_KINDS_COOKIES|ALL_DOM_STORAGE|DeleteAllCookies/,
  );
  assert.match(baselinePolicy, /Cookies and DOM storage are intentionally untouched/);
});

test('HTTP cache is session-local instead of permanently disabled', () => {
  assert.doesNotMatch(sharedEnvironment, /--disable-http-cache/);
  assert.match(sharedEnvironment, /--disable-features=BackForwardCache/);
  assert.match(
    sharedEnvironment,
    /HTTP[\s\S]*cache is enabled during a live controller session[\s\S]*explicitly reset/,
  );
});

test('rollback adds no native stats diagnostic channel', () => {
  assert.doesNotMatch(
    baselinePolicy,
    /stationhead-play-stats-diagnostic|response body|authorization fingerprint/i,
  );
});
