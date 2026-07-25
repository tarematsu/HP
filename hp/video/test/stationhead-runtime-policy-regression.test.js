import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const policySource = readFileSync(
  new URL('../../native/src/sh_polling_policy.h', import.meta.url),
  'utf8',
);
const runtimeFixSource = readFileSync(
  new URL('../../native/src/sh_runtime_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('active runtime policy wraps the existing autoplay implementation', () => {
  const baseAutoplay = section(
    policySource,
    'inline std::wstring StationheadAutoplayScript(',
    '// Window A may ask for stats',
  );
  assert.match(baseAutoplay, /StationheadAutoplayScriptBase\(globalName, messagePrefix\)/);

  const runtimeAutoplay = section(
    runtimeFixSource,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// Window A\'s successful stats request',
  );
  assert.match(runtimeAutoplay, /StationheadAutoplayScript\(globalName, messagePrefix\)/);
  assert.match(runtimeAutoplay, /homepanel-stationhead-auth-ready/);
  assert.match(runtimeAutoplay, /if \(playing\(\)\) scan\(\);/);
  assert.match(runtimeAutoplay, /5000/);
  assert.match(runtimeAutoplay, /if \(timer\) return;/);
  assert.match(
    runtimeFixSource,
    /#define StationheadAutoplayScript StationheadAutoplayScriptRuntimeFixed/,
  );
});

test('Window A runtime stats throttle follows the validated authorization', () => {
  const stats = section(
    runtimeFixSource,
    'inline std::wstring StationheadApiPlayStatsScriptRuntimeFixed(',
    '}  // namespace hp',
  );
  assert.match(stats, /const resetSuccessThrottle = \(\) =>/);
  assert.match(stats, /__homepanelStationheadPlayStatsAuthorization = '';/);
  assert.match(stats, /lastSuccessAuthorization === headers\.authorization/);
  assert.match(
    stats,
    /__homepanelStationheadPlayStatsAuthorization = headers\.authorization;/,
  );

  const unauthorized = section(
    stats,
    'if (response.status === 401)',
    'if (response.status === 403)',
  );
  assert.match(unauthorized, /__homepanelStationheadRejectedAuthorization/);
  assert.match(unauthorized, /__homepanelStationheadAuthHeaders = null/);

  const forbidden = section(
    stats,
    'if (response.status === 403)',
    'if (!response.ok)',
  );
  assert.match(forbidden, /resetSuccessThrottle\(\)/);
  assert.match(forbidden, /error: 'forbidden'/);
  assert.doesNotMatch(forbidden, /__homepanelStationheadRejectedAuthorization/);
  assert.doesNotMatch(forbidden, /__homepanelStationheadAuthHeaders = null/);
  assert.match(
    runtimeFixSource,
    /#define StationheadApiPlayStatsScript StationheadApiPlayStatsScriptRuntimeFixed/,
  );
});

test('runtime policy override is compiled after the base polling policy', () => {
  assert.match(
    cmakeSource,
    /set\(HOMEPANEL_STATIONHEAD_SOURCES[\s\S]*src\/sh_polling_policy\.h[\s\S]*src\/sh_runtime_policy_fix\.h/,
  );
  assert.match(
    cmakeSource,
    /target_precompile_headers\(HomePanel PRIVATE[\s\S]*src\/sh_polling_policy\.h[\s\S]*src\/sh_runtime_policy_fix\.h\)/,
  );
});
