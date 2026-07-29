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

test('stats session guard is the final auth/stats policy before interactive memory', () => {
  const validationAt = navigationPolicy.indexOf(
    '#include "sh_auth_capture_validation_policy_fix.h"',
  );
  const rotationAt = navigationPolicy.indexOf(
    '#include "sh_auth_candidate_rotation_policy_fix.h"',
  );
  const fallbackAt = navigationPolicy.indexOf(
    '#include "sh_stats_auth_fallback_policy_fix.h"',
  );
  const sessionAt = navigationPolicy.indexOf(
    '#include "sh_stats_session_policy_fix.h"',
  );
  const memoryAt = navigationPolicy.indexOf(
    '#include "sh_auth_interactive_memory_policy_fix.h"',
  );
  assert.ok(validationAt >= 0 && validationAt < rotationAt);
  assert.ok(rotationAt < fallbackAt && fallbackAt < sessionAt);
  assert.ok(sessionAt < memoryAt);
  assert.match(
    policy,
    /#undef StationheadAuthCaptureScript[\s\S]*#define StationheadAuthCaptureScript[\s\\]+StationheadAuthCaptureScriptStatsSessionSafe/,
  );
  assert.match(
    policy,
    /#undef StationheadApiPlayStatsScript[\s\S]*#define StationheadApiPlayStatsScript[\s\\]+StationheadApiPlayStatsScriptStatsSessionSafe/,
  );
});

test('authorization generations belong to bearer values rather than requests', () => {
  const capture = section(
    policy,
    'inline std::wstring StationheadAuthCaptureScriptStatsSessionSafe',
    '// Generate the statistics request directly',
  );
  assert.match(capture, /const authorizationGenerations = new Map\(\);/);
  assert.match(capture, /authorizationGenerations\.get\(authorization\)/);
  assert.match(capture, /authorizationGenerations\.set\(authorization, generation\)/);
  assert.match(capture, /observation\.generation < acceptedAuthorizationGeneration/);
  assert.doesNotMatch(capture, /candidateOrders = new WeakMap/);

  let nextGeneration = 0;
  let acceptedGeneration = 0;
  let current = '';
  const generations = new Map();
  const observe = authorization => {
    let generation = generations.get(authorization);
    if (!generation) {
      generation = ++nextGeneration;
      generations.set(authorization, generation);
    }
    return { authorization, generation };
  };
  const accept = observation => {
    if (observation.generation < acceptedGeneration) return;
    acceptedGeneration = Math.max(acceptedGeneration, observation.generation);
    current = observation.authorization;
  };

  const early = observe('Bearer early');
  accept(early);
  const account = observe('Bearer account');
  accept(account);
  accept(observe('Bearer early')); // old bearer sent by a later request
  assert.equal(current, 'Bearer account');
});

test('only successful responses validate credentials and account 403 is rejected for stats', () => {
  const capture = section(
    policy,
    'inline std::wstring StationheadAuthCaptureScriptStatsSessionSafe',
    '// Generate the statistics request directly',
  );
  assert.match(capture, /status === 401[\s\S]*rejectGlobally\(observation\)/);
  assert.match(
    capture,
    /status === 403 && observation\.accountScoped[\s\S]*rejectForStats\(observation\)/,
  );
  assert.match(capture, /status >= 200 && status < 400[\s\S]*accept\(observation\)/);
  assert.doesNotMatch(capture, /status > 0[\s\S]*accept\(observation\)/);
  assert.match(capture, /path\.startsWith\('\/me\/'\)/);
  assert.match(capture, /path\.startsWith\('\/account\/'\)/);
});

test('stats request prefers account auth and never uses a rejected candidate during cooldown', () => {
  const stats = section(
    policy,
    'inline std::wstring StationheadApiPlayStatsScriptStatsSessionSafe',
    '}  // namespace hp',
  );
  const accountAt = stats.indexOf(
    'const accountHeaders = window.__homepanelStationheadAccountAuthHeaders;',
  );
  const currentAt = stats.indexOf(
    'const currentHeaders = window.__homepanelStationheadAuthHeaders;',
  );
  const acceptedAt = stats.indexOf(
    'const acceptedHeaders = window.__homepanelStationheadLastAcceptedAuthHeaders;',
  );
  assert.ok(accountAt >= 0 && accountAt < currentAt && currentAt < acceptedAt);
  assert.match(stats, /authorization !== globallyRejected/);
  assert.match(stats, /statsCooldownActive\(authorization\)/);
  assert.match(stats, /now - statsRejectedAt < 30 \* 1000/);
  assert.match(stats, /BlockingLoginVisible === true/);
});

test('401 and 403 invalidate the stats context and request a short native retry', () => {
  const stats = section(
    policy,
    'inline std::wstring StationheadApiPlayStatsScriptStatsSessionSafe',
    '}  // namespace hp',
  );
  assert.match(stats, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(stats, /clearMatching\('__homepanelStationheadAccountAuthHeaders'\)/);
  assert.match(stats, /__homepanelStationheadStatsRejectedAuthorization/);
  assert.match(
    stats,
    /post\(\{ type: 'stationhead-play-stats-auth-failed', status \}\)/,
  );
});

test('response normalization accepts timestamp units, renamed fields, arrays, and date maps', () => {
  const stats = section(
    policy,
    'inline std::wstring StationheadApiPlayStatsScriptStatsSessionSafe',
    '}  // namespace hp',
  );
  assert.match(stats, /numeric < 100000000000\) numeric \*= 1000/);
  assert.match(stats, /numeric > 100000000000000\) numeric \/= 1000/);
  assert.match(stats, /'chart_data', 'chartData', 'daily', 'history', 'points', 'values'/);
  assert.match(stats, /Object\.entries\(candidate\)\.map/);
  assert.match(stats, /point\.timestamp/);
  assert.match(stats, /point\.plays/);
  assert.match(stats, /data: \{ chart_data: chartData \}/);
  assert.match(stats, /error: 'invalid-payload'/);
  assert.doesNotMatch(stats, /JSON\.stringify\(data\)/);
});
