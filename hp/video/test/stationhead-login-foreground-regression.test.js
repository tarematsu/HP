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

test('final runtime policy treats responsive-hidden Log in as authentication required', () => {
  const autoplay = section(
    runtime,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  const loginProbe = section(
    autoplay,
    'const blockingLoginVisible = () => {',
    'const playing = () => {',
  );

  assert.match(autoplay, /loginPattern = \/\^\(log\\s\*in\|sign\\s\*in\|login/);
  assert.match(loginProbe, /const label = labelOf\(element\);/);
  assert.match(loginProbe, /getAttribute\?\.\('href'\)/);
  assert.match(loginProbe, /loginPattern\.test\(label\)/);
  assert.match(loginProbe, /login\|signin\|sign-in/);
  assert.doesNotMatch(
    loginProbe,
    /!visible\(element\)[^\n]*loginPattern|visible\(element\)[^\n]*loginPattern/,
  );
  assert.match(
    autoplay,
    /if \(!robustLoginReported && pageActive && nativePost\) \{[\s\S]*nativePost\(loginMessage\);/,
  );
  assert.doesNotMatch(
    composition,
    /StationheadAutoplayScriptForegroundLogin|#define StationheadAutoplayScript/,
  );
});

test('final runtime policy also promotes the live Connect music surface', () => {
  const autoplay = section(
    runtime,
    'inline std::wstring StationheadAutoplayScriptRuntimeFixed(',
    '// The page can complete a fresh login',
  );
  const loginProbe = section(
    autoplay,
    'const blockingLoginVisible = () => {',
    'const playing = () => {',
  );

  assert.match(autoplay, /const authHeadingSelector = "h1,h2,h3,\[role='heading'\]";/);
  assert.match(autoplay, /const serviceConnectPattern = \/\^connect\\s\+music\$\/i;/);
  assert.match(
    loginProbe,
    /for \(const heading of document\.querySelectorAll\(authHeadingSelector\)\)[\s\S]*visible\(heading\) && serviceConnectPattern\.test\(labelOf\(heading\)\)/,
  );
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
