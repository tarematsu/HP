import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const appHeader = readFileSync(
  new URL('../../native/src/app.h', import.meta.url),
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

test('active runtime policy gates message sources and generic login links', () => {
  const baseAutoplay = section(
    policySource,
    'inline std::wstring StationheadAutoplayScript(',
    '// Window A may ask for stats',
  );
  assert.match(baseAutoplay, /StationheadAutoplayScriptBase\(globalName, messagePrefix\)/);

  const runtimeAutoplay = section(
    runtimeFixSource,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  assert.match(runtimeAutoplay, /StationheadAutoplayScript\(globalName, messagePrefix\)/);
  assert.match(runtimeAutoplay, /const topLevelStationhead =/);
  assert.match(runtimeAutoplay, /window\.top === window/);
  assert.match(runtimeAutoplay, /if \(!topLevelStationhead\)/);
  assert.match(runtimeAutoplay, /const blockedPost = \(\) => undefined/);
  assert.match(runtimeAutoplay, /webview\.postMessage = blockedPost/);
  assert.match(runtimeAutoplay, /Object\.defineProperty\(webview, 'postMessage'/);
  const sourceGateAt = runtimeAutoplay.indexOf('if (!topLevelStationhead)');
  const runtimeGuardAt = runtimeAutoplay.indexOf('AuthRecheck) return;');
  assert.ok(sourceGateAt >= 0 && sourceGateAt < runtimeGuardAt);

  assert.match(runtimeAutoplay, /const blockingLoginVisible = \(\) =>/);
  assert.match(runtimeAutoplay, /login\|signin\|sign-in\|auth/);
  assert.match(runtimeAutoplay, /form,\[role='dialog'\],\[aria-modal='true'\]/);
  assert.match(runtimeAutoplay, /credentialSelector/);
  assert.match(runtimeAutoplay, /const restoreAuthAfterFalsePositive = \(\) =>/);
  assert.match(runtimeAutoplay, /__homepanelStationheadLastAcceptedAuthHeaders/);
  assert.match(
    runtimeAutoplay,
    /if \(message === loginMessage\)[\s\S]*if \(!updateBlockingLogin\(\)\) restoreAuthAfterFalsePositive\(\);[\s\S]*return;/,
  );
  assert.match(runtimeAutoplay, /homepanelStationheadBlockingLoginVisible = true/);
  assert.match(runtimeAutoplay, /homepanelStationheadBlockingLoginVisible = false/);
  assert.match(runtimeAutoplay, /now - loginMissingSince >= 3000/);
  assert.match(runtimeAutoplay, /addEventListener\('pagehide',[\s\S]*pageActive = false/);
  assert.match(runtimeAutoplay, /addEventListener\('pageshow',[\s\S]*pageActive = true/);
  assert.match(
    runtimeAutoplay,
    /message\.type === 'stationhead-auth-ready'[\s\S]*nativeTimeout\([\s\S]*if \(pageActive\) nativePost\(message\)/,
  );
  assert.match(runtimeAutoplay, /if \(playing\(\)\) baseScan\(\);/);
  assert.match(runtimeAutoplay, /updateBlockingLogin\(\);[\s\S]*5000/);
  assert.match(runtimeAutoplay, /if \(timer\) return;/);
  assert.match(
    runtimeFixSource,
    /#define StationheadAutoplayScript StationheadAutoplayScriptRuntimeFixed/,
  );
});

test('same-token login recovery is accepted only after the blocking UI clears', () => {
  const authCapture = section(
    runtimeFixSource,
    'inline std::wstring StationheadAuthCaptureScriptRuntimeFixed()',
    "// Window A's successful stats request",
  );
  assert.match(authCapture, /StationheadAuthCaptureScript\(\)/);
  assert.match(authCapture, /window\.top !== window/);
  assert.match(authCapture, /const rememberAcceptedAuthorization = \(\) =>/);
  assert.match(authCapture, /__homepanelStationheadLastAcceptedAuthHeaders = Object\.assign/);
  assert.match(authCapture, /const releaseRejectedAuthorization = authorization =>/);
  assert.match(
    authCapture,
    /authorization !== window\.__homepanelStationheadRejectedAuthorization/,
  );
  assert.match(
    authCapture,
    /window\.__homepanelStationheadBlockingLoginVisible !== false/,
  );
  assert.match(
    authCapture,
    /window\.__homepanelStationheadRejectedAuthorization = null/,
  );
  assert.match(authCapture, /window\.fetch = function\(input, init\)/);
  assert.match(authCapture, /const result = currentFetch\(input, init\);[\s\S]*rememberAcceptedAuthorization\(\);/);
  assert.match(authCapture, /NativeXhr\.prototype\.send = function/);
  assert.match(authCapture, /const result = currentSend\.apply\(this, args\);[\s\S]*rememberAcceptedAuthorization\(\);/);
  assert.match(
    runtimeFixSource,
    /#define StationheadAuthCaptureScript StationheadAuthCaptureScriptRuntimeFixed/,
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

test('Stationhead state changes shorten the central idle timer', () => {
  assert.match(appHeader, /kStationheadStateWakeMs = 2'000/);
  const markDirty = section(
    appHeader,
    'void MarkStationheadPlacementDirty() noexcept',
    'void ProcessRemoteCommands();',
  );
  assert.match(markDirty, /stationheadPlacementDirty_ = true;/);
  assert.match(markDirty, /ScheduleNextTick\(kStationheadStateWakeMs\);/);
});
