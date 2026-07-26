import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const nativeCmake = readFileSync(
  new URL('../hp/native/CMakeLists.txt', import.meta.url),
  'utf8',
);

test('native package installs the repository third-party notices file', () => {
  assert.equal(existsSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url)), true);
  assert.match(
    nativeCmake,
    /\$\{CMAKE_CURRENT_SOURCE_DIR\}\/\.\.\/\.\.\/THIRD_PARTY_NOTICES\.md/,
  );
  assert.doesNotMatch(
    nativeCmake,
    /\$\{CMAKE_CURRENT_SOURCE_DIR\}\/\.\.\/THIRD_PARTY_NOTICES\.md/,
  );
});
