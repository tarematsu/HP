import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fallback = readFileSync(
  new URL('../../native/src/app_startup_tick_fallback.cpp', import.meta.url),
  'utf8',
);
const fallbackHeader = readFileSync(
  new URL('../../native/src/app_startup_tick_fallback.h', import.meta.url),
  'utf8',
);
const appHeader = readFileSync(
  new URL('../../native/src/app.h', import.meta.url),
  'utf8',
);
const app = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);
const messages = readFileSync(
  new URL('../../native/src/app_messages.cpp', import.meta.url),
  'utf8',
);
const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('automatic update wake is a dedicated posted message, not a synthetic timer', () => {
  assert.match(fallbackHeader, /kStartupUpdateWakeMessage\s*=\s*WM_APP \+ 21/);
  assert.match(fallback, /kStartupFallbackFirstDelayMs\s*=\s*60'000/);
  assert.match(fallback, /kStartupFallbackRetryMs\s*=\s*5'000/);
  assert.match(fallback, /kStartupFallbackAttempts\s*=\s*7/);
  assert.match(
    fallback,
    /PostMessageW\(window, kStartupUpdateWakeMessage, 0, 0\)/,
  );
  assert.doesNotMatch(fallback, /PostMessageW\(window, WM_TIMER/);
  assert.doesNotMatch(
    fallback,
    /GetForegroundWindow|IsWindowVisible|selectedTab_|StationheadTabKind/,
  );
});

test('fallback is tied to the App window lifetime and validates HWND ownership', () => {
  const windowProc = section(
    messages,
    'LRESULT CALLBACK App::WindowProc(',
    'void App::ProcessPendingStationheadTrackBoundaryRefreshes(',
  );
  assert.match(windowProc, /StartStartupUpdateFallback\(window, app\)/);
  assert.match(windowProc, /message == WM_NCDESTROY/);
  assert.match(windowProc, /StopStartupUpdateFallback\(\)/);
  assert.match(windowProc, /SetWindowLongPtrW\(window, GWLP_USERDATA, 0\)/);

  assert.match(fallback, /GetWindowThreadProcessId\(window, &processId\)/);
  assert.match(fallback, /processId != GetCurrentProcessId\(\)/);
  assert.match(
    fallback,
    /GetWindowLongPtrW\(window, GWLP_USERDATA\)\) == owner/,
  );
  assert.doesNotMatch(fallback, /FindWindowW/);
});

test('dedicated wake evaluates only the startup update scheduler', () => {
  const wakeCase = section(
    messages,
    'case kStartupUpdateWakeMessage:',
    'case WM_PAINT:',
  );
  assert.match(wakeCase, /HandleStartupUpdateWake\(\)/);
  assert.doesNotMatch(wakeCase, /Tick\(\)/);

  assert.match(appHeader, /void HandleStartupUpdateWake\(\)/);
  const handler = section(
    fallback,
    'void App::HandleStartupUpdateWake()',
    '}  // namespace hp',
  );
  assert.match(
    handler,
    /!startupUpdateScheduled_ && renderer_ && sensors_ && stationhead_ && cloud_/,
  );
  assert.match(
    handler,
    /StartDeferredServices\(UnixMillis\(\), renderState_\.stationhead\)/,
  );
  assert.match(
    handler,
    /if \(startupUpdateScheduled_\) CompleteStartupUpdateFallback\(\)/,
  );

  const deferred = section(
    app,
    'void App::StartDeferredServices(',
    'void App::StopServices()',
  );
  assert.match(
    deferred,
    /!startupUpdateScheduled_ && cloudStarted_ && now - startupAt_ >= 60'000/,
  );
  assert.match(deferred, /CheckForUpdateAsync\(false\)/);
});

test('fallback retries are cancelable and built into HomePanel only', () => {
  assert.match(fallback, /wake_\.wait_for/);
  assert.match(fallback, /stopping_ \|\| completed_/);
  assert.match(fallback, /completed_ = true/);
  assert.match(fallback, /wake_\.notify_all\(\)/);
  assert.match(fallback, /if \(worker_\.joinable\(\)\) worker_\.join\(\)/);
  assert.match(
    cmake,
    /set\(HOMEPANEL_CORE_SOURCES[\s\S]*src\/app_startup_tick_fallback\.cpp/,
  );
  const updaterSources = section(
    cmake,
    'set(HOMEPANEL_UPDATER_SOURCES',
    'add_executable(HomePanelUpdater',
  );
  assert.doesNotMatch(updaterSources, /app_startup_tick_fallback/);
});
