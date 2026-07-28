import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url),
  'utf8',
);

const common = readNative('common.h');
const loggerHeader = readNative('logger.h');
const loggerSource = readNative('logger.cpp');
const updateSource = readNative('app_update.cpp');
const sensorsSource = readNative('sensors.cpp');
const sharedEnvironment = readNative('shared_webview_environment.cpp');

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('runtime logging cannot throw through callback or worker boundaries', () => {
  assert.match(loggerHeader, /void Info\([^)]*\) noexcept/);
  assert.match(loggerHeader, /void Warn\([^)]*\) noexcept/);
  assert.match(loggerHeader, /void Error\([^)]*\) noexcept/);
  assert.match(loggerHeader, /void Write\([^)]*\) noexcept/);

  const write = section(
    loggerSource,
    'void Logger::Write(',
    '\n}\n\n}  // namespace hp',
  );
  assert.match(write, /try \{/);
  assert.match(write, /catch \(\.\.\.\)/);
});

test('noexcept process wrappers catch allocation failures before fallback', () => {
  const environment = section(
    common,
    'inline const wchar_t* SafeWideGetEnv',
    'inline bool EndsWithInsensitive',
  );
  assert.match(environment, /try \{/);
  assert.match(environment, /catch \(\.\.\.\)/);
  assert.match(environment, /return nullptr/);

  const updaterCopy = section(
    common,
    'inline BOOL CopyFileWithActiveUpdaterAwareness',
    'inline bool AtomicWriteBytes',
  );
  assert.match(updaterCopy, /try \{/);
  assert.match(updaterCopy, /catch \(\.\.\.\)/);
  assert.match(updaterCopy, /return ::CopyFileW\(existingFileName, newFileName, failIfExists\)/);
});

test('update worker always resets busy state and contains all entry exceptions', () => {
  assert.match(updateSource, /class UpdateBusyGuard final/);
  assert.match(updateSource, /~UpdateBusyGuard\(\)[\s\S]*busy_\.store\(false/);
  assert.match(updateSource, /void PostUpdateResultNoexcept\([^)]*\) noexcept/);

  const worker = section(
    updateSource,
    'updateThread_ = std::thread(',
    '\n  } catch (...) {\n    updateBusy_.store',
  );
  assert.match(worker, /UpdateBusyGuard busyGuard\(updateBusy_\)/);
  assert.match(worker, /catch \(const std::exception& error\)/);
  assert.match(worker, /catch \(\.\.\.\)/);
  assert.match(worker, /Update worker stopped after an internal failure/);
});

test('sensor worker failure reporting cannot throw a second exception', () => {
  const start = section(
    sensorsSource,
    'void SensorHub::Start()',
    'void SensorHub::Stop()',
  );
  assert.match(start, /const auto publishFailure = \[this\]\(\) noexcept/);
  assert.match(start, /publishFailure[\s\S]*catch \(\.\.\.\)/);
  assert.match(start, /catch \(const std::exception& error\)/);
  assert.match(start, /catch \(\.\.\.\)/);
  assert.match(start, /stopping_ = true;\s*throw;/);
});

test('WebView process hint failures remain inside the guarded acquisition path', () => {
  assert.match(sharedEnvironment, /void ApplyWebView2ProcessHints\(\) \{/);
  assert.doesNotMatch(sharedEnvironment, /void ApplyWebView2ProcessHints\(\) noexcept/);
  const acquireCreation = section(
    sharedEnvironment,
    '  try {\n    std::error_code directoryError;',
    '  } catch (const std::bad_alloc&) {\n    Complete(requestedKey, creationGeneration',
  );
  assert.match(acquireCreation, /ApplyWebView2ProcessHints\(\)/);
});
