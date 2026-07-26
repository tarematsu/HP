import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const nativeCmake = readFileSync(
  new URL('../hp/native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const nativeWorkflow = readFileSync(
  new URL('../.github/workflows/native-windows-build.yml', import.meta.url),
  'utf8',
);

function stepSection(name, nextName) {
  const start = nativeWorkflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `${name} step must exist`);
  const end = nativeWorkflow.indexOf(`      - name: ${nextName}\n`, start + 1);
  assert.notEqual(end, -1, `${nextName} step must exist after ${name}`);
  return nativeWorkflow.slice(start, end);
}

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

test('native pull requests build and package hp/native changes without publishing', () => {
  const pullRequestTrigger = nativeWorkflow.slice(
    nativeWorkflow.indexOf('  pull_request:\n'),
    nativeWorkflow.indexOf('  push:\n'),
  );
  assert.match(pullRequestTrigger, /- "hp\/native\/\*\*"/);

  const packageStep = stepSection('Package native release', 'Prepare release assets');
  assert.match(packageStep, /if: github\.event_name == 'pull_request'/);
  assert.match(packageStep, /cmake --install hp\/native\/build-ci/);

  const publishStep = stepSection('Upload update assets to R2', 'Trigger immediate update rollout');
  assert.match(publishStep, /if: github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(publishStep, /github\.event_name == 'pull_request'/);
});
