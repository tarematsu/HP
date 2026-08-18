import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const avatarPolicy = readFileSync(
  new URL('../../native/src/sh_login_avatar_policy_fix.h', import.meta.url),
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

test('final Stationhead composition installs the account-avatar settlement bridge', () => {
  assert.match(composition, /#include "sh_login_avatar_policy_fix\.h"/);
  assert.match(
    avatarPolicy,
    /return StationheadAutoplayScript\(globalName, messagePrefix\);/,
  );
  assert.match(
    avatarPolicy,
    /#define StationheadAutoplayScript StationheadAutoplayScriptAvatarSettlementFixed/,
  );
});

test('native postMessage is captured before wrapped runtime policy is appended', () => {
  const captureAt = avatarPolicy.indexOf(
    'window.__homepanelStationheadNativePost =',
  );
  const baseAt = avatarPolicy.indexOf("script << L'\\n' << base << L'\\n';");
  const detectorAt = avatarPolicy.indexOf(
    'window.__homepanelStationheadAvatarSettlement = true;',
  );

  assert.ok(captureAt >= 0);
  assert.ok(baseAt > captureAt);
  assert.ok(detectorAt > baseAt);
  assert.match(avatarPolicy, /webview\.postMessage\.bind\(webview\)/);
});

test('top-right account image is detected directly instead of requiring an interactive wrapper', () => {
  assert.match(avatarPolicy, /const avatarSelector =/);
  assert.match(avatarPolicy, /img,picture/);
  assert.match(avatarPolicy, /data-testid\*='avatar'/);
  assert.match(avatarPolicy, /class\*='avatar'/);
  assert.match(avatarPolicy, /innerWidth \* 0\.60/);
  assert.match(avatarPolicy, /rect\.top > 128/);
  assert.match(avatarPolicy, /rect\.width < 12/);
  assert.match(avatarPolicy, /rect\.width > 112/);
  assert.doesNotMatch(avatarPolicy, /naturalWidth|naturalHeight|\.complete/);
});

test('stable account avatar clears the native login latch without page auth capture', () => {
  assert.match(avatarPolicy, /now - avatarSince >= 3000/);
  assert.match(
    avatarPolicy,
    /nativePost\(\{ type: 'stationhead-auth-ready' \}\)/,
  );
  assert.doesNotMatch(
    avatarPolicy,
    /dispatchEvent\(new Event\('homepanel-stationhead-auth-ready'\)\)/,
  );

  const authReadyAt = webview.indexOf(
    'if (type == L"stationhead-auth-ready") {',
  );
  assert.ok(authReadyAt >= 0);
  const authReadyHandler = webview.slice(authReadyAt, authReadyAt + 1800);
  assert.match(authReadyHandler, /loginRequired_ = false;/);
  assert.match(authReadyHandler, /status_\.loginRequired = false;/);
  assert.match(authReadyHandler, /nextTickAt_ = 0;/);
  assert.match(authReadyHandler, /PostChange\(\);/);
});

test('visible authentication surfaces win and later logout can re-latch login', () => {
  assert.match(avatarPolicy, /const strongAuthSurfaceVisible = \(\) =>/);
  assert.match(avatarPolicy, /loginRoute\(\)/);
  assert.match(avatarPolicy, /credentialSelector/);
  assert.match(avatarPolicy, /connectMusicPattern/);
  assert.match(avatarPolicy, /loginControlPresent\(true\)/);
  assert.match(
    avatarPolicy,
    /if \(authenticatedReported\)[\s\S]*nativePost\(loginMessage\)/,
  );
  assert.match(
    avatarPolicy,
    /authenticatedReported && loginControlPresent\(false\)[\s\S]*now - anonymousSince >= 3000[\s\S]*nativePost\(loginMessage\)/,
  );
});

test('legacy page auth capture remains disabled', () => {
  assert.match(
    composition,
    /inline std::wstring StationheadAuthCaptureScriptDisabled\(\) \{\s*return L"void 0";/,
  );
  assert.match(
    composition,
    /#define StationheadAuthCaptureScript StationheadAuthCaptureScriptDisabled/,
  );
});
