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

test('active runtime policy gates message sources and resolves login against account UI', () => {
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
  const audioOnlyAt = runtimeAutoplay.indexOf('StationheadAudioOnlyUiScript()');
  const blankRecoveryAt = runtimeAutoplay.indexOf(
    'StationheadBlankPageRecoveryScriptRuntimeFixed()',
  );
  const baseAt = runtimeAutoplay.indexOf(
    'StationheadAutoplayScriptBase(globalName, messagePrefix)',
  );
  assert.ok(audioOnlyAt >= 0 && audioOnlyAt < blankRecoveryAt);
  assert.ok(blankRecoveryAt >= 0 && blankRecoveryAt < baseAt);
  assert.doesNotMatch(
    runtimeAutoplay,
    /StationheadAutoplayScript\(globalName, messagePrefix\)/,
  );
  assert.match(runtimeAutoplay, /const topLevelStationhead =/);
  assert.match(runtimeAutoplay, /window\.top === window/);
  assert.match(runtimeAutoplay, /if \(!topLevelStationhead\)/);
  assert.match(runtimeAutoplay, /const blockedPost = \(\) => undefined/);
  assert.match(runtimeAutoplay, /webview\.postMessage = blockedPost/);
  assert.match(runtimeAutoplay, /Object\.defineProperty\(webview, 'postMessage'/);
  const sourceGateAt = runtimeAutoplay.indexOf('if (!topLevelStationhead)');
  const runtimeGuardAt = runtimeAutoplay.indexOf('AuthRecheck) return;');
  assert.ok(sourceGateAt >= 0 && sourceGateAt < runtimeGuardAt);

  assert.match(runtimeAutoplay, /const accountUiVisible = \(\) =>/);
  assert.match(runtimeAutoplay, /const loginSurfaceState = \(\) =>/);
  assert.match(runtimeAutoplay, /login\|signin\|sign-in\|auth/);
  assert.match(runtimeAutoplay, /const credentialSelector =/);
  assert.match(runtimeAutoplay, /getAttribute\?\.\('href'\)/);
  assert.match(runtimeAutoplay, /loginPattern\.test\(label\)/);
  assert.match(runtimeAutoplay, /login\|signin\|sign-in/);
  assert.match(runtimeAutoplay, /const authenticated = accountUiVisible\(\)/);
  assert.match(runtimeAutoplay, /blocking: loginSeen && !authenticated/);
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
    /message\.type === 'stationhead-auth-ready'[\s\S]*if \(surface\.blocking\)[\s\S]*pendingAuthReady = message;[\s\S]*nativeTimeout\([\s\S]*updateBlockingLogin\(\);[\s\S]*flushPendingAuthReady\(\);/,
  );
  assert.match(
    runtimeAutoplay,
    /const flushPendingAuthReady = \(\) => \{[\s\S]*homepanelStationheadBlockingLoginVisible !== false[\s\S]*nativePost\?\.\(message\);/,
  );
  assert.match(runtimeAutoplay, /if \(playing\(\)\) baseScan\(\);/);
  assert.match(runtimeAutoplay, /updateBlockingLogin\(\);[\s\S]*5000/);
  assert.match(runtimeAutoplay, /if \(timer\) return;/);
  assert.match(
    runtimeFixSource,
    /#define StationheadAutoplayScript StationheadAutoplayScriptRuntimeFixed/,
  );
});

test('blank-page recovery preserves valid account and playback interaction', () => {
  const recovery = section(
    runtimeFixSource,
    'inline std::wstring StationheadBlankPageRecoveryScriptRuntimeFixed()',
    '// Locate only a genuine playback control',
  );
  assert.match(recovery, /window\.top !== window/);
  assert.match(recovery, /const protectedInteractionVisible = \(\) =>/);
  assert.match(recovery, /credentialSelector/);
  assert.match(recovery, /homepanelStationheadBlockingLoginVisible === true/);
  assert.match(recovery, /start listening\|listen now\|listen live/);
  assert.match(recovery, /spotify\|connect spotify\|log in\|sign in\|login/);
  assert.match(
    recovery,
    /playing\(\) \|\| protectedInteractionVisible\(\)[\s\S]*blankSince = 0;/,
  );
  assert.match(
    recovery,
    /pageActive && !playing\(\) && !protectedInteractionVisible\(\)[\s\S]*sparseDarkSurface\(\)[\s\S]*location\.reload\(\)/,
  );
});

test('blank-page recovery retires timers with the document lifetime', () => {
  const recovery = section(
    runtimeFixSource,
    'inline std::wstring StationheadBlankPageRecoveryScriptRuntimeFixed()',
    '// Locate only a genuine playback control',
  );
  assert.match(recovery, /const nativeClearInterval = window\.clearInterval\.bind\(window\)/);
  assert.match(recovery, /const nativeClearTimeout = window\.clearTimeout\.bind\(window\)/);
  assert.match(recovery, /let pageActive = true;/);
  assert.match(recovery, /const stop = \(\) => \{/);
  assert.match(recovery, /nativeClearInterval\(interval\)/);
  assert.match(recovery, /cancelReload\(\)/);
  assert.match(recovery, /nativeClearTimeout\(loadCheckTimer\)/);
  assert.match(recovery, /addEventListener\('pagehide', stop, true\)/);
  assert.match(
    recovery,
    /addEventListener\('pageshow',[\s\S]*pageActive = true;[\s\S]*start\(\);[\s\S]*check\(\);/,
  );
});

test('native Start click cannot target account or authorization controls', () => {
  const locator = section(
    runtimeFixSource,
    'inline std::wstring StationheadLocateStartButtonScriptRuntimeFixed()',
    '// The base resource callback captured',
  );
  assert.match(locator, /window\.top !== window/);
  assert.match(locator, /const accountInteractionVisible = \(\) =>/);
  assert.match(locator, /credentialSelector/);
  assert.match(locator, /homepanelStationheadBlockingLoginVisible === true/);
  assert.match(locator, /if \(!document\.body \|\| playing\(\) \|\| accountInteractionVisible\(\)\) return null;/);
  assert.match(locator, /login\|signin\|sign-in\|auth\|account\|settings/);
  assert.match(locator, /spotify\|authorize\|consent/);
  assert.match(locator, /form,\[role='dialog'\],\[aria-modal='true'\]/);
  assert.match(locator, /document\.elementFromPoint\(x, y\)/);
  assert.match(
    runtimeFixSource,
    /#define StationheadLocateStartButtonScript StationheadLocateStartButtonScriptRuntimeFixed/,
  );
});

test('resource filtering callbacks do not borrow StationheadPlayer lifetime', () => {
  const blocking = section(
    runtimeFixSource,
    'inline void ApplyStationheadResourceBlockingRuntimeFixed(',
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
  );
  assert.match(blocking, /\(void\)armed;/);
  assert.match(blocking, /\[env, blockImages, blockFonts\]/);
  assert.doesNotMatch(blocking, /\[env,\s*&armed/);
  assert.match(blocking, /StationheadRequestIsBlockable\(lower\)/);
  assert.match(blocking, /StationheadCorePlaybackRequest\(lower\)/);
  assert.match(blocking, /BlockStationheadTelemetrySockets\(webview, config\.blockImages\)/);
  assert.match(blocking, /ApplyStationheadNonPlaybackScriptBlocking\(environment, webview\)/);
  assert.match(blocking, /ApplyStationheadAdditionalScriptBlocking\(environment, webview\)/);
  assert.match(
    runtimeFixSource,
    /#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingRuntimeFixed/,
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
