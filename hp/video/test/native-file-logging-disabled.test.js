import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = relative => readFileSync(
  new URL(`../../native/${relative}`, import.meta.url),
  'utf8',
);

const loggerHeader = readNative('src/logger.h');
const loggerSource = readNative('src/logger.cpp');
const updaterNoLog = readNative('src/updater_no_file_logging.h');
const cmake = readNative('CMakeLists.txt');
const runtimeSmoke = readNative('scripts/ci-native-runtime-smoke.ps1');
const updaterSmoke = readNative('scripts/ci-updater-runtime-smoke.ps1');

test('HomePanel Logger is a zero-allocation zero-file-I/O sink', () => {
  assert.match(loggerHeader, /explicit Logger\([^)]*\) noexcept \{\}/);
  assert.match(loggerHeader, /void Info\([^)]*\) const noexcept \{\}/);
  assert.match(loggerHeader, /void Warn\([^)]*\) const noexcept \{\}/);
  assert.match(loggerHeader, /void Error\([^)]*\) const noexcept \{\}/);
  assert.doesNotMatch(loggerHeader, /ofstream|wofstream|mutex|flush|rotate|path_/i);
  assert.doesNotMatch(loggerSource, /ofstream|wofstream|\.write\(|\.flush\(|create_directories|file_size/i);
});

test('HomePanelUpdater compiles its diagnostic wide stream to a sink', () => {
  assert.match(updaterNoLog, /class HomePanelNullWideOutputStream final/);
  assert.match(updaterNoLog, /operator<<\(T&&\) noexcept/);
  assert.match(updaterNoLog, /#define wofstream HomePanelNullWideOutputStream/);
  assert.match(
    cmake,
    /target_precompile_headers\(HomePanelUpdater PRIVATE src\/updater_no_file_logging\.h\)/,
  );
});

test('runtime smoke asserts diagnostic log files are absent', () => {
  assert.match(runtimeSmoke, /unexpectedly created data\/homepanel\.log/);
  assert.match(updaterSmoke, /unexpectedly created data\/homepanel-updater\.log/);
  assert.match(updaterSmoke, /unexpectedly created data\/homepanel\.log/);
  assert.doesNotMatch(runtimeSmoke, /Get-Content[^\n]*homepanel\.log/);
  assert.doesNotMatch(updaterSmoke, /Get-Content[^\n]*homepanel(?:-updater)?\.log/);
});
