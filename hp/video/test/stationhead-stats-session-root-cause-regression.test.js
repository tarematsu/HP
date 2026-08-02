import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationPolicy = readFileSync(
  new URL('../../native/src/sh_auth_navigation_policy_fix.h', import.meta.url),
  'utf8',
);
const policy = readFileSync(
  new URL('../../native/src/sh_stats_session_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

const capture = section(
  policy,
  'inline std::wstring StationheadAuthCaptureScriptStatsSessionSafe',
  'inline std::wstring StationheadApiPlayStatsScriptStatsSessionSafe',
);
const stats = section(
  policy,
  'inline std::wstring StationheadApiPlayStatsScriptStatsSessionSafe',
  '\n}  // namespace hp',
);

test('the rebuilt play-count policy remains the final override', () => {
  const baselineAt = navigationPolicy.indexOf(
    '#include "sh_stats_july26_baseline_policy_fix.h"',
  );
  const sessionAt = navigationPolicy.indexOf(
    '#include "sh_stats_session_policy_fix.h"',
  );
  assert.ok(baselineAt >= 0 && sessionAt > baselineAt);
  assert.match(
    policy,
    /#undef StationheadAuthCaptureScript[\s\S]*StationheadAuthCaptureScriptStatsSessionSafe/,
  );
  assert.match(
    policy,
    /#undef StationheadApiPlayStatsScript[\s\S]*StationheadApiPlayStatsScriptStatsSessionSafe/,
  );
});

test('authentication capture is delegated instead of wrapped a second time', () => {
  assert.match(capture, /std::wstring script = StationheadAuthCaptureScript\(\);/);
  assert.match(capture, /window\.__homepanelPlayCountBridge/);
  assert.match(capture, /type: 'stationhead-stats-document'/);
  assert.match(capture, /type: 'stationhead-auth-ready'/);
  assert.doesNotMatch(capture, /window\.fetch = function/);
  assert.doesNotMatch(capture, /XMLHttpRequest\.prototype/);
  assert.doesNotMatch(capture, /authorizationGenerations = new Map/);
});

test('one document and one in-flight request define response identity', () => {
  assert.match(stats, /__homepanelStationheadStatsDocumentGeneration/);
  assert.match(stats, /type: 'stationhead-stats-document'/);
  const inFlightAt = stats.indexOf(
    'if (window.__homepanelStationheadPlayStatsInFlight) return false;',
  );
  const requestAt = stats.indexOf(
    'const requestId = safePositiveInteger(',
  );
  const latestAt = stats.indexOf(
    'window.__homepanelStationheadPlayStatsLatestRequestId = requestId;',
  );
  assert.ok(inFlightAt >= 0 && requestAt > inFlightAt && latestAt > requestAt);
  assert.match(
    stats,
    /const stillCurrent = \(\) =>[\s\S]*StatsDocumentActive === true[\s\S]*StatsDocumentGeneration ===[\s\S]*documentGeneration[\s\S]*LatestRequestId === requestId/,
  );
  assert.doesNotMatch(stats, /authorizationGenerations/);
  assert.doesNotMatch(stats, /acceptedAuthorizationGeneration/);
});

test('the request uses a bounded retryable lifecycle', () => {
  assert.match(stats, /window\.addEventListener\('pagehide'/);
  assert.match(stats, /20 \* 1000/);
  assert.match(stats, /30 \* 1000/);
  assert.match(stats, /scheduleRetry\('request-timeout'\)/);
  assert.match(stats, /if \(window\.__homepanelStationheadPlayStatsInFlight\) return false/);
  assert.match(stats, /now - lastSuccessAt < 5 \* 60 \* 1000/);
});

test('response normalization accepts known streakStats representations', () => {
  assert.match(stats, /numeric < 100000000000\) numeric \*= 1000/);
  assert.match(stats, /numeric > 100000000000000\) numeric \/= 1000/);
  assert.match(stats, /'chart_data', 'chartData', 'daily', 'history', 'points', 'values'/);
  assert.match(stats, /Object\.entries\(candidate\)\.map/);
  assert.match(stats, /point\.timestamp/);
  assert.match(stats, /point\.plays/);
  assert.match(stats, /data: \{ chart_data: chartData \}/);
  assert.match(stats, /source: 'authenticated-api-normalized-v4'/);
  assert.match(stats, /scheduleRetry\('invalid-payload'\)/);
});

test('credentials stay page-local and are cleared on account rejection', () => {
  assert.match(stats, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(stats, /clearMatching\('__homepanelStationheadAuthHeaders'\)/);
  assert.match(stats, /clearMatching\('__homepanelStationheadAccountAuthHeaders'\)/);
  assert.match(stats, /type: 'stationhead-play-stats-auth-failed'/);
  assert.doesNotMatch(policy, /localStorage|sessionStorage/);
  assert.doesNotMatch(policy, /console\.log\(.*authorization/i);
});
