import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url),
  'utf8',
);
const baselinePolicy = readFileSync(
  new URL('../../native/src/sh_stats_july26_baseline_policy_fix.h', import.meta.url),
  'utf8',
);
const pollingPolicy = readFileSync(
  new URL('../../native/src/sh_polling_policy.h', import.meta.url),
  'utf8',
);
const sharedPolicy = readFileSync(
  new URL('../../native/src/sh_shared.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('July 26 auth and stats generators are restored after every later wrapper', () => {
  const validationAt = navigationPolicy.indexOf(
    '#include "sh_auth_capture_validation_policy_fix.h"',
  );
  const sessionAt = navigationPolicy.indexOf(
    '#include "sh_stats_session_policy_fix.h"',
  );
  const memoryAt = navigationPolicy.indexOf(
    '#include "sh_auth_interactive_memory_policy_fix.h"',
  );
  const baselineAt = navigationPolicy.indexOf(
    '#include "sh_stats_july26_baseline_policy_fix.h"',
  );
  assert.ok(validationAt >= 0 && validationAt < sessionAt);
  assert.ok(sessionAt < memoryAt && memoryAt < baselineAt);

  assert.match(
    baselinePolicy,
    /#undef StationheadAuthCaptureScript[\s\S]*StationheadAuthCaptureScriptJuly26Baseline/,
  );
  assert.match(
    baselinePolicy,
    /#undef StationheadApiPlayStatsScript[\s\S]*StationheadApiPlayStatsScriptJuly26Baseline/,
  );
  assert.match(
    baselinePolicy,
    /return StationheadAuthCaptureScript\(\);/,
  );
  assert.match(
    baselinePolicy,
    /return StationheadApiPlayStatsScript\(channelId\);/,
  );
});

test('restored auth capture uses the latest page-owned Stationhead request immediately', () => {
  const capture = section(
    sharedPolicy,
    'inline std::wstring StationheadAuthCaptureScript()',
    'inline std::wstring StationheadApiPlayStatsScript',
  );
  assert.match(capture, /const authorization = getHeader\('authorization'\);/);
  assert.match(capture, /window\.__homepanelStationheadAuthHeaders = next;/);
  assert.match(
    capture,
    /capture\(url, name => headers\.get\(name\)\);[\s\S]*return nativeFetch\(input, init\);/,
  );
  assert.match(
    capture,
    /capture\(this\.__homepanelUrl, name => this\.__homepanelHeaders\?\.\[name\]\)/,
  );
  assert.doesNotMatch(capture, /response => recordAuthorizationStatus/);
  assert.doesNotMatch(capture, /authorizationGenerations/);
});

test('restored stats request forwards the raw July 26 streakStats payload', () => {
  const stats = section(
    pollingPolicy,
    'inline std::wstring StationheadApiPlayStatsScript(int channelId)',
    '// Window B must not make an extra logged-in API request',
  );
  assert.match(stats, /const headers = window\.__homepanelStationheadAuthHeaders;/);
  assert.match(stats, /production1\.stationhead\.com\/me\/channel\//);
  assert.match(stats, /credentials: 'include'/);
  assert.match(stats, /post\(\{ type: 'stationhead-play-stats', data, source: 'authenticated-api' \}\)/);
  assert.doesNotMatch(stats, /AccountAuthHeaders/);
  assert.doesNotMatch(stats, /LatestValidatedAuthHeaders/);
  assert.doesNotMatch(stats, /chartFrom|normalizePoint|invalid-payload/);
});

test('baseline restoration adds no native diagnostic channel', () => {
  assert.doesNotMatch(baselinePolicy, /postMessage|diagnostic|payload keys|response body/i);
});
