import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import core from '../src/entry-core.js';
import entry from '../src/entry.js';

const coreSource = await readFile(new URL('../src/entry-core.js', import.meta.url), 'utf8');

test('authenticated status responses are private at their core construction point', () => {
  assert.equal(entry, core);
  assert.match(coreSource, /STATUS_RESPONSE_HEADERS/);
  assert.match(coreSource, /'cache-control', 'private, no-store'/);
  assert.match(coreSource, /'x-content-type-options', 'nosniff'/);
  assert.doesNotMatch(coreSource, /x-edge-cache/i);
  assert.doesNotMatch(coreSource, /public, max-age=60, s-maxage=300/);
});

test('cached status snapshots preserve private headers without response rewriting', () => {
  assert.match(coreSource, /headers: STATUS_RESPONSE_HEADERS/);
  assert.match(coreSource, /body: JSON\.stringify\(data\)/);
  assert.doesNotMatch(coreSource, /protectPrivateStatusResponse/);
  assert.doesNotMatch(coreSource, /body: await response\.text\(\)/);
});
