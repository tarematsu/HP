import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(
  new URL('../../native/src/sh_runtime_policy_fix.h', import.meta.url),
  'utf8',
);
const lifecycle = readFileSync(
  new URL('../../native/src/sh_runtime_lifecycle_policy_fix.h', import.meta.url),
  'utf8',
);
const composition = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const webview = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);
const audioLoss = readFileSync(
  new URL('../../native/src/sh_audio_loss.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('hidden menu Log in is only a passive pre-auth signal', () => {
  const autoplay = section(
    runtime,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  const loginProbe = section(
    autoplay,
    'const loginSurfaceState = () => {',
    'const playing = () => {',
  );
  const update = section(
    autoplay,
    'const updateBlockingLogin = () => {',
    'const flushPendingAuthReady = () => {',
  );

  assert.match(autoplay, /loginPattern = \/\^\(log\\s\*in\|sign\\s\*in\|login/);
  assert.match(loginProbe, /let passive = false;/);
  assert.match(loginProbe, /getAttribute\?\.\('href'\)/);
  assert.match(loginProbe, /if \(visible\(element\)\) return \{ strong: true, passive: true \};/);
  assert.match(loginProbe, /passive = true;/);
  assert.match(loginProbe, /return \{ strong: false, passive \};/);
  assert.match(update, /surface\.strong \|\| \(surface\.passive && !confirmedAuthenticated\)/);
  assert.match(
    autoplay,
    /if \(!robustLoginReported && pageActive && nativePost\) \{[\s\S]*nativePost\(loginMessage\);/,
  );
  assert.doesNotMatch(
    composition,
    /StationheadAutoplayScriptForegroundLogin|#define StationheadAutoplayScript/,
  );
});

test('auth-ready settles hidden menu login without relatching foreground', () => {
  const autoplay = section(
    runtime,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  const interception = section(
    autoplay,
    "if (message && typeof message === 'object' &&",
    'return nativePost(message);',
  );

  assert.match(autoplay, /let confirmedAuthenticated = false;/);
  assert.match(interception, /message\.type === 'stationhead-auth-ready'/);
  assert.match(interception, /const surface = loginSurfaceState\(\);/);
  assert.match(interception, /if \(surface\.strong\) \{[\s\S]*updateBlockingLogin\(\);[\s\S]*return;/);
  assert.match(interception, /confirmedAuthenticated = true;/);
  assert.match(interception, /pendingAuthReady = message;/);
  assert.match(interception, /updateBlockingLogin\(\);[\s\S]*flushPendingAuthReady\(\);/);
});

test('visible login and Connect music remain strong blockers after auth', () => {
  const autoplay = section(
    runtime,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  const loginProbe = section(
    autoplay,
    'const loginSurfaceState = () => {',
    'const playing = () => {',
  );
  const update = section(
    autoplay,
    'const updateBlockingLogin = () => {',
    'const flushPendingAuthReady = () => {',
  );

  assert.match(autoplay, /const authHeadingSelector = "h1,h2,h3,\[role='heading'\]";/);
  assert.match(autoplay, /const serviceConnectPattern = \/\^connect\\s\+music\$\/i;/);
  assert.match(
    loginProbe,
    /visible\(heading\) && serviceConnectPattern\.test\(labelOf\(heading\)\)[\s\S]*return \{ strong: true, passive: true \}/,
  );
  assert.match(loginProbe, /if \(visible\(element\)\) return \{ strong: true, passive: true \};/);
  assert.match(update, /if \(surface\.strong\) confirmedAuthenticated = false;/);
});

test('login detector is assembled before optional startup policies', () => {
  const autoplay = section(
    runtime,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  const detectorAt = autoplay.indexOf('std::wostringstream extension;');
  const assembledAt = autoplay.indexOf('std::wstring script = extension.str();');
  const uiAt = autoplay.indexOf('script.append(StationheadAudioOnlyUiScript());');
  const blankAt = autoplay.indexOf(
    'script.append(StationheadBlankPageRecoveryScriptRuntimeFixed());',
  );
  const baseAt = autoplay.indexOf(
    'script.append(StationheadAutoplayScriptBase(globalName, messagePrefix));',
  );

  assert.ok(detectorAt >= 0);
  assert.ok(assembledAt > detectorAt);
  assert.ok(uiAt > assembledAt);
  assert.ok(blankAt > uiAt);
  assert.ok(baseAt > blankAt);
});

test('final lifecycle keeps login detection active while music is playing', () => {
  const fixedSchedule = section(
    lifecycle,
    'static constexpr std::wstring_view kScheduleFixed =',
    'static constexpr std::wstring_view kPageLifecycle =',
  );
  const fixedTail = section(
    lifecycle,
    'static constexpr std::wstring_view kAuthReadyTailFixed =',
    'const bool uiLifecycleReplaced =',
  );

  assert.match(fixedSchedule, /const loginRecheckMs = 5000;/);
  assert.match(fixedSchedule, /updateBlockingLogin\(\);/);
  assert.doesNotMatch(fixedSchedule, /playing\(\)|stablePlaybackRecheckMs|30000/);
  assert.match(fixedTail, /DOMContentLoaded', recheckLoginSurface/);
  assert.match(fixedTail, /addEventListener\('load', recheckLoginSurface/);
});

test('native login-required message always surfaces Stationhead', () => {
  const handler = section(
    webview,
    'if (message == prefix + L"-login-required") {',
    'LPWSTR messageRaw = nullptr;',
  );

  assert.match(handler, /loginRequired_ = true;/);
  assert.match(handler, /ShowForLogin\(\);/);
  assert.doesNotMatch(handler, /AudioPlaying\(|audioPlaying_|playing\)/);
});

test('audible playback cannot clear a confirmed login-required surface', () => {
  const audioPlayingBranch = section(
    audioLoss,
    'const bool audioPlaying = AudioPlaying();',
    'const bool authenticationPending =',
  );

  assert.match(
    audioPlayingBranch,
    /selectedTab_ == StationheadTabKind::Stationhead &&[\s\S]*!spotifyAuthorization_ && !loginRequired_/,
  );
  assert.match(audioPlayingBranch, /SelectTab\(StationheadTabKind::None\);/);
  assert.doesNotMatch(audioPlayingBranch, /loginRequired_ = false;/);
  assert.doesNotMatch(audioPlayingBranch, /status_\.loginRequired = false;/);
});
