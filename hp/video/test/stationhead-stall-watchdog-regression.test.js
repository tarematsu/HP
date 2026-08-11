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

test('the media progress watchdog is layered after runtime recovery polling', () => {
  assert.match(cmake, /src\/sh_media_stall_watchdog_policy_fix\.h/);
  const recoveryPch = cmake.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_recovery_polling_policy_fix.h)',
  );
  const watchdogPch = cmake.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_media_stall_watchdog_policy_fix.h)',
  );
  assert.ok(recoveryPch >= 0 && watchdogPch > recoveryPch);
  assert.match(
    watchdog,
    /#include "sh_runtime_recovery_polling_policy_fix\.h"/,
  );
  assert.match(
    watchdog,
    /StationheadAutoplayScriptRecoveryPollingFixed\(globalName, messagePrefix\)/,
  );
  assert.match(watchdog, /#undef StationheadAutoplayScript/);
  assert.match(
    watchdog,
    /#define StationheadAutoplayScript StationheadAutoplayScriptWithMediaProgressWatchdog/,
  );
});

test('stalled active media progress reloads after a guarded two-minute window', () => {
  assert.match(watchdog, /document\.querySelectorAll\('audio,video'\)/);
  assert.match(watchdog, /element\.paused \|\| element\.ended/);
  assert.match(watchdog, /element\.readyState < 2/);
  assert.match(watchdog, /element\.currentTime/);
  assert.match(watchdog, /sampleIntervalMs = 15 \* 1000/);
  assert.match(watchdog, /stallThresholdMs = 2 \* 60 \* 1000/);
  assert.match(watchdog, /reloadCooldownMs = 5 \* 60 \* 1000/);
  assert.match(watchdog, /nativeSetTimeout/);
  assert.match(watchdog, /nativeClearTimeout/);
  assert.doesNotMatch(watchdog, /setInterval/);
  assert.match(watchdog, /const mediaAdvanced = lastProgressSignature !== ''/);
  assert.match(watchdog, /if \(mediaAdvanced\) clearLastReloadAt\(\)/);
  assert.match(watchdog, /sessionStorage\.setItem\(reloadKey/);
  assert.match(watchdog, /location\.reload\(\)/);
});

test('the watchdog resumes when a Stationhead document returns from BFCache', () => {
  assert.match(watchdog, /const stop = \(\) => \{[\s\S]*pageActive = false/);
  assert.match(watchdog, /const resume = \(\) => \{[\s\S]*pageActive = true/);
  assert.match(watchdog, /lastProgressSignature = ''/);
  assert.match(watchdog, /window\.addEventListener\('pagehide', stop, true\)/);
  assert.match(watchdog, /window\.addEventListener\('pageshow', resume, true\)/);
  assert.match(watchdog, /resume[\s\S]*check\(\);[\s\S]*schedule\(\);/);
});

test('recent-hour history keeps one sample per five-minute bucket', () => {
  assert.match(nativeStats, /kHistorySampleBucketMs = 5LL \* 60 \* 1000/);
  assert.match(nativeStats, /const int64_t bucket = receivedAt \/ kHistorySampleBucketMs/);
  assert.match(
    nativeStats,
    /history_\.back\(\)\.first \/ kHistorySampleBucketMs == bucket/,
  );
  assert.match(nativeStats, /history_\.back\(\) = sample/);
  assert.match(nativeStats, /history_\.push_back\(sample\)/);
  assert.match(nativeStats, /latest\.first - 60LL \* 60 \* 1000/);
  assert.doesNotMatch(nativeStats, /history_\.erase\(history_\.end\(\) - 2\)/);
});
