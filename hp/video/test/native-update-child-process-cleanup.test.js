import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/app_startup_tick_fallback.cpp', import.meta.url),
  'utf8',
);

function section(start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('verified update shutdown terminates HomePanel descendants before closing', () => {
  const windowProc = section(
    'LRESULT CALLBACK ProtectedWindowProc(',
    'void InstallWindowProtection(',
  );
  const cleanupAt = windowProc.indexOf('TerminateUpdateChildProcesses();');
  const closeAt = windowProc.indexOf('CallWindowProcW(original, window, WM_CLOSE, 0, 0)');
  assert.ok(cleanupAt >= 0 && closeAt >= 0 && cleanupAt < closeAt);
});

test('update child cleanup walks descendants and preserves updater subtree', () => {
  const cleanup = section(
    'void TerminateUpdateChildProcesses() noexcept',
    'void LogWindowCallbackFailure()',
  );
  assert.match(cleanup, /CreateToolhelp32Snapshot\(TH32CS_SNAPPROCESS, 0\)/);
  assert.match(cleanup, /candidate\.th32ParentProcessID != parent\.pid/);
  assert.match(cleanup, /parent\.updaterTree \|\| IsUpdateRunner\(candidate\)/);
  assert.match(cleanup, /if \(current->pid == appPid \|\| current->updaterTree\) continue/);
  assert.match(cleanup, /TerminateProcess\(process, 0\)/);
});

test('only HomePanelUpdater is protected from update cleanup', () => {
  const detector = section(
    'bool IsUpdateRunner(',
    'void TerminateUpdateChildProcesses()',
  );
  assert.match(detector, /HomePanelUpdater\.exe/);
  assert.doesNotMatch(detector, /msedgewebview2|Spotify|Stationhead|YouTube|TVer/i);
});
