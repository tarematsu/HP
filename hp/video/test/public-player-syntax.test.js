import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const modules = [
  'public/app-resilient.js',
  'public/orientation-gesture-bad.js',
  'public/gesture-layout.js'
];

test('deployed player modules pass the Node syntax checker', () => {
  for (const modulePath of modules) {
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ['--check', modulePath], {
        cwd: repositoryRoot,
        stdio: 'pipe'
      });
    }, modulePath);
  }
});
