import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const updaterSource = readFileSync(
  new URL('../../native/src/updater.cpp', import.meta.url),
  'utf8',
);
const updaterEntrySource = readFileSync(
  new URL('../../native/src/updater_entry.cpp', import.meta.url),
  'utf8',
);
const appUpdateSource = readFileSync(
  new URL('../../native/src/app_update.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('native app remains active while the updater validates release files', () => {
  const check = section(
    appUpdateSource,
    'void App::CheckForUpdateAsync(bool install)',
    'bool App::LaunchVerifiedUpdater(',
  );
  const launched = section(
    check,
    'if (LaunchVerifiedUpdater(manifest.version, manifestJson))',
    'message = L"検証済み更新プログラムを起動できませんでした"',
  );
  assert.doesNotMatch(launched, /WM_CLOSE/);

  const launch = section(
    appUpdateSource,
    'bool App::LaunchVerifiedUpdater(',
    '\n}\n\n}  // namespace hp',
  );
  assert.match(launch, /command\.append\(L" --app-pid "\)/);
  assert.match(launch, /AppendUnsigned\(command, GetCurrentProcessId\(\)\)/g);
});

test('only a verified runner can request HomePanel shutdown', () => {
  assert.match(updaterSource, /bool gRunnerMode = false/);

  const requestExit = section(
    updaterSource,
    'void RequestHomePanelExit(DWORD pid)',
    'void EnsureHomePanelStopped(',
  );
  assert.match(requestExit, /if \(!gRunnerMode \|\| !pid\) return/);

  const waitForParent = section(
    updaterSource,
    'void WaitForExit(DWORD pid)',
    'void ReplaceOne(',
  );
  assert.ok(
    waitForParent.indexOf('RequestHomePanelExit(pid)') <
      waitForParent.indexOf('WaitForSingleObject('),
    'the runner must request graceful shutdown only after downloads and verification finish',
  );

  const ensureStopped = section(
    updaterSource,
    'void EnsureHomePanelStopped(DWORD pid, const fs::path& root)',
    'bool LaunchRunner(',
  );
  assert.ok(
    ensureStopped.indexOf('RequestHomePanelExit(pid)') <
      ensureStopped.indexOf('WaitForSingleObject('),
    'standalone updates must request graceful app shutdown immediately before installation',
  );
});

test('failure recovery does not wait on a HomePanel instance that is still healthy', () => {
  const restart = section(
    updaterSource,
    'void RestartHomePanel(const fs::path& root)',
    'void RestoreBackup(',
  );
  assert.match(restart, /const DWORD existingPid = FindHomePanelProcess\(root\)/);
  assert.match(restart, /if \(existingPid\)[\s\S]*return;/);
  assert.doesNotMatch(restart, /WaitForExit\(existingPid\)/);
  assert.ok(
    restart.indexOf('return;') < restart.indexOf('CreateProcessW('),
    'an existing healthy app must be left running instead of blocking recovery',
  );
});

test('hardened updater failure recovery uses the guarded restart path', () => {
  assert.match(updaterEntrySource, /#include "updater\.cpp"/);
  const entrypoint = section(
    updaterEntrySource,
    'int WINAPI wWinMain(',
    '\n}',
  );
  assert.match(
    entrypoint,
    /if \(runnerMode\)[\s\S]*hp::RestartHomePanel\(root\)/,
  );
});
