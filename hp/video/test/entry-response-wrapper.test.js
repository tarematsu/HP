import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import core from '../src/entry-core.js';
import entry from '../src/entry.js';

const entrySource = await readFile(new URL('../src/entry.js', import.meta.url), 'utf8');
const coreSource = await readFile(new URL('../src/entry-core.js', import.meta.url), 'utf8');

test('Worker entry keeps the migration wrapper narrow and delegates normal traffic', () => {
  assert.notEqual(entry, core);
  assert.equal(typeof entry.fetch, 'function');
  assert.equal(typeof entry.queue, 'function');
  assert.equal(typeof entry.scheduled, 'function');
  assert.match(entrySource, /migrationFreezeEnabled/);
  assert.match(entrySource, /return core\.fetch\(request, env, ctx\)/);
  assert.match(entrySource, /return core\.queue\(batch, env, ctx\)/);
  assert.match(entrySource, /return core\.scheduled\(controller, env, ctx\)/);
  assert.doesNotMatch(entrySource, /protectPrivateStatusResponse/);
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
