import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url),
  'utf8',
);

const startupFallback = readNative('app_startup_tick_fallback.cpp');
const mainSource = readNative('main.cpp');
const sensorsSource = readNative('sensors.cpp');
const shutdownProtocol = readNative('update_shutdown_protocol.h');
const updaterEntry = readNative('updater_entry.cpp');

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('verified updater shutdown does not use a generic WM_CLOSE', () => {
  assert.match(shutdownProtocol, /kUpdateShutdownMessage\s*=\s*WM_APP\s*\+\s*11/);
  assert.match(
    updaterEntry,
    /#define WM_CLOSE hp::kUpdateShutdownMessage[\s\S]*#include "updater\.cpp"/,
  );

  assert.match(startupFallback, /message == kUpdateShutdownMessage/);
  assert.match(startupFallback, /message == WM_CLOSE/);
  assert.match(startupFallback, /if \(!gUserCloseRequested\) return 0/);
  assert.match(startupFallback, /WM_SYSCOMMAND[\s\S]*SC_CLOSE[\s\S]*gUserCloseRequested = true/);
});

test('standalone updater is visible before network access', () => {
  const helper = section(
    updaterEntry,
    'int ShowUpdaterMessage(',
    '}  // namespace hp',
  );
  assert.match(helper, /MB_TOPMOST\s*\|\s*MB_SETFOREGROUND/);

  const standalone = section(
    updaterEntry,
    'int HardenedRunStandalone(',
    'void HardenedInstallPendingUpdate(',
  );
  assert.ok(
    standalone.indexOf('ShowUpdaterMessage(') <
      standalone.indexOf('FetchAuthorizedManifest(root)'),
    'standalone updater must show progress before its first network request',
  );
  assert.match(updaterEntry, /Zone\.Identifier/);
  assert.match(updaterEntry, /AllowSetForegroundWindow\(process\.dwProcessId\)/);
});

test('native callback and worker exceptions cannot terminate the process silently', () => {
  const windowProc = section(
    startupFallback,
    'LRESULT CALLBACK ProtectedWindowProc(',
    'void InstallWindowProtection(',
  );
  assert.match(windowProc, /try \{/);
  assert.match(windowProc, /catch \(\.\.\.\)/);

  const sensorStart = section(
    sensorsSource,
    'void SensorHub::Start()',
    'void SensorHub::Stop()',
  );
  assert.match(sensorStart, /try \{\s*SerialLoop\(\)/);
  assert.match(sensorStart, /catch \(const std::exception& error\)/);
  assert.match(sensorStart, /catch \(\.\.\.\)/);

  assert.match(mainSource, /std::set_terminate\(TerminateHandler\)/);
  assert.match(mainSource, /--crash-restart/);
  assert.match(mainSource, /RelaunchAfterCrashOnce\(\)/);
  const entrypoint = section(mainSource, 'int WINAPI wWinMain(', '\n}');
  assert.ok(
    entrypoint.indexOf('try {') < entrypoint.indexOf('winrt::init_apartment('),
    'COM initialization failures must be reported through the startup exception boundary',
  );
});
