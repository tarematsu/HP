import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appHeader = readFileSync(
  new URL('../../native/src/app.h', import.meta.url),
  'utf8',
);
const updateSource = readFileSync(
  new URL('../../native/src/app_update.cpp', import.meta.url),
  'utf8',
);
const commandSource = readFileSync(
  new URL('../../native/src/app_commands.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('automatic cloud updates do not treat same-version hash drift as a release', () => {
  assert.match(
    appHeader,
    /void CheckForUpdateAsync\(bool install, bool allowSameVersionRepair\)/,
  );

  const remoteCommand = section(
    commandSource,
    'bool success = command == L"check_update"',
    'pendingAcks[id] = success',
  );
  assert.match(remoteCommand, /CheckForUpdateAsync\(true, false\)/);
  assert.doesNotMatch(remoteCommand, /CheckForUpdateAsync\(true\);/);
});

test('same-version file repair remains available only for explicit local requests', () => {
  const wrapper = section(
    updateSource,
    'void App::CheckForUpdateAsync(bool install)',
    'void App::CheckForUpdateAsync(bool install, bool allowSameVersionRepair)',
  );
  assert.match(wrapper, /CheckForUpdateAsync\(install, install\)/);

  const implementation = section(
    updateSource,
    'void App::CheckForUpdateAsync(bool install, bool allowSameVersionRepair)',
    'bool App::LaunchVerifiedUpdater(',
  );
  assert.match(
    implementation,
    /sameVersion && allowSameVersionRepair &&[\s\S]*ManifestFilesDiffer/,
  );
  assert.match(
    implementation,
    /if \(!newerVersion && !replacementBuild\)/,
  );
});
