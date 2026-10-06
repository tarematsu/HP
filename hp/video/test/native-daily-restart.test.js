import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);
const appHeader = readFileSync(
  new URL('../../native/src/app.h', import.meta.url),
  'utf8',
);
const main = readFileSync(
  new URL('../../native/src/main.cpp', import.meta.url),
  'utf8',
);

test('native app schedules the next restart for 20:00 local time', () => {
  assert.match(app, /constexpr int kDailyRestartLocalHour = 20;/);
  assert.match(app, /GetLocalTime\(&local\)/);
  assert.match(app, /nextDailyRestartAt_ = startupAt_ \+ MillisecondsUntilNextDailyRestart\(\)/);
  assert.match(app, /now >= nextDailyRestartAt_/);
  assert.match(app, /exitCode_ = kScheduledRestartExitCode/);
  assert.match(appHeader, /kScheduledRestartExitCode = 43/);
});

test('scheduled restart relaunch is tagged separately from manual restart', () => {
  assert.match(main, /--scheduled-restart/);
  assert.match(main, /App app\(instance, HasCommandArgument\(L"--scheduled-restart"\)\)/);
  assert.match(main, /result == hp::App::kScheduledRestartExitCode/);
  assert.match(main, /RelaunchSelf\(false, true\)/);
});

test('scheduled relaunch performs one foreground click after startup', () => {
  assert.match(app, /kPostRestartClickDelayMs = 1'500/);
  assert.match(app, /PerformPostRestartClick\(\)/);
  assert.match(app, /SetForegroundWindow\(window_\)/);
  assert.match(app, /SetCursorPos\(clickPoint\.x, clickPoint\.y\)/);
  assert.match(app, /MOUSEEVENTF_LEFTDOWN/);
  assert.match(app, /MOUSEEVENTF_LEFTUP/);
  assert.match(app, /SendInput\(_countof\(inputs\), inputs, sizeof\(INPUT\)\)/);
  assert.match(app, /postRestartClickPending_ = false/);
});
