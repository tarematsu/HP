import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = (path) => readFileSync(
  new URL(`../../native/src/${path}`, import.meta.url), 'utf8');

const recovery = readNative('app_error_dialog_recovery.h');
const main = readNative('main.cpp');
const app = readNative('app.cpp');
const appHeader = readNative('app.h');
const renderer = readNative('renderer_panels.cpp');
const media = readNative('renderer_panels/media_host.inc');

test('only visible, explicit Windows runtime error dialogs trigger recovery', () => {
  assert.match(recovery, /EnumWindows\(/);
  assert.match(recovery, /IsWindowVisible\(window\)/);
  assert.match(recovery, /wcscmp\(className, L"#32770"\)/);
  assert.match(recovery, /msedgewebview2\.exe/);
  assert.match(recovery, /homepanel\.exe/);
  assert.match(recovery, /msedge\.exe/);
  assert.match(recovery, /application error/);
  assert.match(recovery, /アプリケーション エラー/);
  assert.match(recovery, /return relevantProcess && fatalError/);
});

test('fatal dialog recovery is confirmed twice, logged and rate-limited', () => {
  assert.match(app, /kErrorDialogCheckIntervalMs = 5'000/);
  assert.match(app, /kErrorDialogRestartCooldownMs = 10LL \* 60LL \* 1000LL/);
  assert.match(app, /dialog == lastErrorDialogTitle_/);
  assert.match(app, /errorDialogConfirmations_ >= 2/);
  assert.match(app, /exitCode_ = kErrorDialogRestartExitCode/);
  assert.match(appHeader, /kErrorDialogRestartExitCode = 44/);
  assert.match(app, /NextDelayFromDeadline\(now, nextErrorDialogCheckAt_, kMaxAppTimerMs\)/);
});

test('error restarts skip X, while manual and scheduled restarts keep X', () => {
  assert.match(main, /if \(errorRestart\) command \+= L" --error-restart"/);
  assert.match(main, /result == hp::App::kErrorDialogRestartExitCode/);
  assert.match(main, /RelaunchSelf\(false, true, true\)/);
  assert.match(main, /RelaunchSelf\(false, true\) \? 0 : 1/);
  assert.match(renderer, /#include "app_error_dialog_recovery\.h"/);
  assert.match(media, /startupXActive_ = !IsErrorDialogRestartLaunch\(\)/);
  assert.match(media, /if \(startupXActive_\)/);
});
