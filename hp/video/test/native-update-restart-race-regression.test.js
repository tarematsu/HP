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

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('updater restart waits for the previous native app process to exit', () => {
  assert.match(
    updaterSource,
    /DWORD FindHomePanelProcess\(const fs::path& root\);\s+void RestartHomePanel/,
  );

  const restart = section(
    updaterSource,
    'void RestartHomePanel(const fs::path& root)',
    'void RestoreBackup(',
  );
  assert.match(restart, /const DWORD existingPid = FindHomePanelProcess\(root\)/);
  assert.match(restart, /WaitForExit\(existingPid\)/);
  assert.ok(
    restart.indexOf('WaitForExit(existingPid)') <
      restart.indexOf('CreateProcessW('),
    'the previous HomePanel process must exit before a replacement is launched',
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
