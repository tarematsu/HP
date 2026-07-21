import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import core from '../src/entry-core.js';
import entry from '../src/entry.js';

const entrySource = await readFile(new URL('../src/entry.js', import.meta.url), 'utf8');

test('all requests bypass entry-level status URL parsing', () => {
  assert.equal(entry, core);
  assert.doesNotMatch(entrySource, /new URL\(/);
  assert.doesNotMatch(entrySource, /includes\('\/api\/status'\)/);
  assert.doesNotMatch(entrySource, /protectPrivateStatusResponse/);
  assert.doesNotMatch(entrySource, /async fetch\(/);
});
