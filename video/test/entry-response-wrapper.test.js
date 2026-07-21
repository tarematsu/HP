import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import core from '../src/entry-core.js';
import entry from '../src/entry.js';

const entrySource = await readFile(new URL('../src/entry.js', import.meta.url), 'utf8');
const coreSource = await readFile(new URL('../src/entry-core.js', import.meta.url), 'utf8');

test('Worker entry exports the core handler without a per-request wrapper', () => {
  assert.equal(entry, core);
  assert.doesNotMatch(entrySource, /protectPrivateStatusResponse/);
  assert.doesNotMatch(entrySource, /async fetch\(/);
  assert.doesNotMatch(entrySource, /new URL\(/);
});

test('cached status snapshots are serialized directly with private headers', () => {
  assert.match(coreSource, /STATUS_RESPONSE_HEADERS/);
  assert.match(coreSource, /'cache-control', 'private, no-store'/);
  assert.match(coreSource, /'content-type', 'application\/json; charset=utf-8'/);
  assert.match(coreSource, /'x-content-type-options', 'nosniff'/);
  assert.match(coreSource, /body: JSON\.stringify\(data\)/);
  assert.doesNotMatch(coreSource, /STATUS_SHARED_CACHE_CONTROL/);
  assert.doesNotMatch(coreSource, /body: await response\.text\(\)/);
});
