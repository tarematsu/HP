import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const fallback = source('app_startup_tick_fallback.cpp');
const fallbackHeader = source('app_startup_tick_fallback.h');
const appHeader = source('app.h');
const app = source('app.cpp');
const messages = source('app_messages.cpp');
const cmake = readFileSync(new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('automatic update wake is a dedicated posted message', () => {
  assert.match(fallbackHeader, /kStartupUpdateWakeMessage\s*=\s*WM_APP \+ 21/);
  assert.match(fallback, /kStartupFallbackFirstDelayMs\s*=\s*60'000/);
  assert.match(fallback, /PostMessageW\(window, kStartupUpdateWakeMessage, 0, 0\)/);
  assert.doesNotMatch(fallback, /PostMessageW\(window, WM_TIMER/);
});

test('fallback follows the App window lifetime', () => {
  const windowProc = section(messages, 'LRESULT CALLBACK App::WindowProc(',
    'LRESULT App::HandleMessage(');
  assert.match(windowProc, /StartStartupUpdateFallback\(window, app\)/);
  assert.match(windowProc, /StopStartupUpdateFallback\(\)/);
  assert.match(fallback, /GetWindowThreadProcessId\(window, &processId\)/);
  assert.doesNotMatch(fallback, /FindWindowW/);
});

test('dedicated wake evaluates the startup update scheduler', () => {
  const wakeCase = section(messages, 'case kStartupUpdateWakeMessage:', 'case WM_PAINT:');
  assert.match(wakeCase, /HandleStartupUpdateWake\(\)/);
  assert.doesNotMatch(wakeCase, /Tick\(\)/);
  assert.match(appHeader, /void HandleStartupUpdateWake\(\)/);
  assert.match(fallback, /StartDeferredServices\(UnixMillis\(\)\)/);

  const deferred = section(app, 'void App::StartDeferredServices(', 'void App::StopServices()');
  assert.match(deferred, /now - startupAt_ >= 60'000/);
  assert.match(deferred, /CheckForUpdateAsync\(false\)/);
});

test('fallback is cancelable and linked only into HomePanel', () => {
  assert.match(fallback, /wake_\.wait_for/);
  assert.match(fallback, /worker_\.joinable\(\)/);
  assert.match(cmake, /src\/app_startup_tick_fallback\.cpp/);
  const updater = section(cmake, 'set(HOMEPANEL_UPDATER_SOURCES', 'add_executable(HomePanelUpdater');
  assert.doesNotMatch(updater, /app_startup_tick_fallback/);
});
