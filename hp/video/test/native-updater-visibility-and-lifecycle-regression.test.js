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

test('standalone and runner updater remain visible during blocking work', () => {
  const helper = section(
    updaterEntry,
    'int ShowUpdaterMessage(',
    '#undef WM_CLOSE',
  );
  assert.match(helper, /MB_TOPMOST\s*\|\s*MB_SETFOREGROUND/);
  assert.match(helper, /class UpdaterProgressWindow/);
  assert.match(helper, /WS_EX_TOPMOST/);
  assert.match(helper, /RedrawWindow\(/);

  const standalone = section(
    updaterEntry,
    'int HardenedRunStandalone(',
    'void HardenedInstallPendingUpdate(',
  );
  assert.ok(
    standalone.indexOf('ShowUpdaterMessage(') <
      standalone.indexOf('FetchAuthorizedManifest(root)'),
    'standalone updater must show confirmation before its first network request',
  );
  assert.match(standalone, /UpdaterProgressWindow progress\(L"更新情報を取得しています/);

  const install = section(
    updaterEntry,
    'void HardenedInstallPendingUpdate(',
    '\n}\n\n}\n}\n\nnamespace {',
  );
  assert.match(install, /UpdaterProgressWindow progress\(L"更新ファイルをダウンロード/);
  assert.match(install, /progress\.SetText\(L"HomePanelを終了して更新ファイルを適用/);
  assert.match(install, /progress\.SetText\(L"更新が完了しました。HomePanelを再起動/);

  assert.match(updaterEntry, /Zone\.Identifier/);
  assert.match(updaterEntry, /AllowSetForegroundWindow\(process\.dwProcessId\)/);
});

test('in-app update uses the verified force-stop path instead of a duplicate parent wait', () => {
  const install = section(
    updaterEntry,
    'void HardenedInstallPendingUpdate(',
    '\n}\n\n}\n}\n\nnamespace {',
  );
  const parentGuard = install.indexOf('if (arguments.parentPid != arguments.appPid)');
  const parentWait = install.indexOf('WaitForExit(arguments.parentPid)');
  const appStop = install.indexOf('EnsureHomePanelStopped(arguments.appPid, arguments.root)');
  assert.ok(parentGuard >= 0 && parentGuard < parentWait);
  assert.ok(parentWait >= 0 && parentWait < appStop);
  assert.match(
    install,
    /if \(arguments\.parentPid != arguments\.appPid\) \{\s*WaitForExit\(arguments\.parentPid\);\s*\}\s*EnsureHomePanelStopped/,
  );
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
