import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const watchdog = readFileSync(
  new URL('../../native/src/sh_media_stall_watchdog_policy_fix.h', import.meta.url),
  'utf8',
);
const nativeStats = readFileSync(
  new URL('../../native/src/stationhead_native_stats.cpp', import.meta.url),
  'utf8',
);

test('the media progress watchdog is precompiled after the canonical polling policy', () => {
  assert.match(cmake, /src\/sh_media_stall_watchdog_policy_fix\.h/);
  assert.match(
    cmake,
    /target_precompile_headers\(HomePanel PRIVATE\s+src\/sh_polling_policy\.h\s+src\/sh_media_stall_watchdog_policy_fix\.h\s+src\/sh_runtime_policy_fix\.h\)/,
  );
  assert.match(watchdog, /#include "sh_polling_policy\.h"/);
  assert.match(
    watchdog,
    /#define StationheadAutoplayScript StationheadAutoplayScriptWithMediaProgressWatchdog/,
  );
});

test('stalled active media progress reloads only after a guarded two-minute window', () => {
  assert.match(watchdog, /document\.querySelectorAll\('audio,video'\)/);
  assert.match(watchdog, /element\.paused \|\| element\.ended/);
  assert.match(watchdog, /element\.readyState < 2/);
  assert.match(watchdog, /element\.currentTime/);
  assert.match(watchdog, /stallThresholdMs = 2 \* 60 \* 1000/);
  assert.match(watchdog, /reloadCooldownMs = 5 \* 60 \* 1000/);
  assert.match(watchdog, /sessionStorage\.setItem\(reloadKey/);
  assert.match(watchdog, /window\.addEventListener\('pagehide', stop, true\)/);
  assert.match(watchdog, /location\.reload\(\)/);
});

test('flat play-count runs retain both endpoints for the one-hour baseline', () => {
  assert.match(nativeStats, /history_\.size\(\) >= 3/);
  assert.match(
    nativeStats,
    /history_\[history_\.size\(\) - 3\]\.second ==[\s\S]*history_\[history_\.size\(\) - 2\]\.second/,
  );
  assert.match(nativeStats, /history_\.erase\(history_\.end\(\) - 2\)/);
  assert.match(nativeStats, /latest\.first - 60LL \* 60 \* 1000/);
  assert.doesNotMatch(
    nativeStats,
    /history_\.size\(\) >= 2 &&\s*history_\[history_\.size\(\) - 2\]\.second == history_\.back\(\)\.second/,
  );
});
