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

test('native app schedules stable randomized restarts in both daily windows', () => {
  assert.match(app, /\{6, 30\}/);
  assert.match(app, /\{19, 30\}/);
  assert.match(app, /kRestartWindowDurationMs = 30LL \* 60LL \* 1000LL/);
  assert.match(app, /StableRestartHash\(const SYSTEMTIME& date, size_t windowIndex\)/);
  assert.match(app, /GetComputerNameW\(computerName, &length\)/);
  assert.match(app, /RestartTargetMillisecondsOfDay\(local, index\)/);
  assert.match(app, /RestartTargetMillisecondsOfDay\(tomorrow, 0\)/);
  assert.match(app, /nextScheduledRestartAt_ = startupAt_ \+ MillisecondsUntilNextRandomizedRestart\(\)/);
  assert.match(app, /now >= nextScheduledRestartAt_/);
  assert.match(app, /exitCode_ = kScheduledRestartExitCode/);
  assert.match(appHeader, /kScheduledRestartExitCode = 43/);
  assert.match(appHeader, /nextScheduledRestartAt_ = 0/);
  assert.doesNotMatch(app, /kDailyRestartLocalHour/);
  assert.doesNotMatch(app, /MillisecondsUntilNextDailyRestart/);
});

test('scheduled restart relaunch is tagged separately from manual restart', () => {
  assert.match(main, /--scheduled-restart/);
  assert.match(main, /HasCommandArgument\(L"--scheduled-restart"\) \|\|/);
  assert.match(main, /HasCommandArgument\(L"--update-restart"\)/);
  assert.match(main, /App app\(instance, postRestartClick\)/);
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
  assert.match(app, /const UINT sent = SendInput\(inputCount, inputs, sizeof\(INPUT\)\)/);
  assert.match(app, /postRestartClickPending_ = false/);
});
