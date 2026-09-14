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
const startup = readFileSync(
  new URL('../../native/src/sh_startup_script.h', import.meta.url),
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

test('responsive hidden Log in stays anonymous until the account avatar replaces it', () => {
  const autoplay = section(
    runtime,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  const accountProbe = section(
    autoplay,
    'const accountUiVisible = () => {',
    'const loginSurfaceState = () => {',
  );
  const loginProbe = section(
    autoplay,
    'const loginSurfaceState = () => {',
    'const playing = () => {',
  );

  assert.match(autoplay, /loginPattern = \/\^\(log\\s\*in\|sign\\s\*in\|login/);
  assert.match(autoplay, /accountPattern = .*account\|profile\|avatar/);
  assert.match(accountProbe, /rect\.top > 96/);
  assert.match(accountProbe, /rect\.right < Math\.max\(96, innerWidth \* 0\.72\)/);
  assert.match(accountProbe, /img,picture/);
  assert.match(accountProbe, /data-testid\*='avatar'/);
  assert.doesNotMatch(accountProbe, /\.complete|naturalWidth|naturalHeight/);
  assert.match(loginProbe, /const authenticated = accountUiVisible\(\);/);
  assert.match(loginProbe, /let loginSeen = false;/);
  assert.match(loginProbe, /loginSeen = true;/);
  assert.match(loginProbe, /return \{ blocking: loginSeen && !authenticated, authenticated \};/);
  assert.match(
    autoplay,
    /if \(!robustLoginReported && pageActive && nativePost\) \{[\s\S]*nativePost\(loginMessage\);/,
  );
  assert.doesNotMatch(
    composition,
    /StationheadAutoplayScriptForegroundLogin|#define StationheadAutoplayScript/,
  );
});

test('auth-ready follows the live account/login surface instead of a sticky auth flag', () => {
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

  assert.doesNotMatch(autoplay, /confirmedAuthenticated/);
  assert.match(interception, /message\.type === 'stationhead-auth-ready'/);
  assert.match(interception, /const surface = loginSurfaceState\(\);/);
  assert.match(interception, /if \(surface\.blocking\) \{[\s\S]*updateBlockingLogin\(\);[\s\S]*return;/);
  assert.match(interception, /pendingAuthReady = message;/);
  assert.match(interception, /updateBlockingLogin\(\);[\s\S]*flushPendingAuthReady\(\);/);
});

test('real auth surfaces still win over a stale account avatar', () => {
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

  assert.match(autoplay, /const authHeadingSelector = "h1,h2,h3,\[role='heading'\]";/);
  assert.match(autoplay, /const blockingShellSelector = "form,\[role='dialog'\],\[aria-modal='true'\]/);
  assert.match(autoplay, /const serviceConnectPattern = \/\^connect\\s\+music\$\/i;/);
  assert.match(
    loginProbe,
    /visible\(heading\) && serviceConnectPattern\.test\(labelOf\(heading\)\)[\s\S]*return \{ blocking: true, authenticated: false \}/,
  );
  assert.match(loginProbe, /const shell = element\.closest\?\.\(blockingShellSelector\);/);
  assert.match(
    loginProbe,
    /if \(!authenticated \|\| \(shell && visible\(shell\)\)\) \{[\s\S]*return \{ blocking: true, authenticated \};/,
  );
});

test('legacy runtime detector remains isolated from the effective startup script', () => {
  const autoplay = section(
    runtime,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  assert.match(autoplay, /StationheadAudioOnlyUiScript/);
  assert.match(autoplay, /StationheadBlankPageRecoveryScriptRuntimeFixed/);
  assert.doesNotMatch(startup, /StationheadAutoplayScriptRuntimeFixed/);
  assert.match(startup, /StationheadCompactRuntimeScript/);
});

test('compact runtime keeps login detection event-driven during playback', () => {
  const compact = section(
    startup,
    'inline std::wstring StationheadCompactRuntimeScript(',
    'inline std::wstring BuildStationheadStartupScript(',
  );
  assert.match(compact, /const publishAuth = \(\) =>/);
  assert.match(compact, /'play', 'playing', 'canplay', 'pause', 'ended', 'stalled', 'waiting', 'error'/);
  assert.match(compact, /document\.addEventListener\(eventName, schedule, true\)/);
  assert.match(compact, /authReadyTimer = nativeTimeout/);
  assert.match(compact, /3000/);
  assert.doesNotMatch(compact, /setInterval\s*\(/);
  assert.doesNotMatch(compact, /new\s+MutationObserver/);
  assert.doesNotMatch(lifecycle, /setInterval|setTimeout|MutationObserver/);
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
