import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import core from '../src/entry-core.js';
import entry from '../src/entry.js';

const entrySource = await readFile(new URL('../src/entry.js', import.meta.url), 'utf8');

test('entry parses one path only for health and private-service routing', () => {
  assert.notEqual(entry, core);
  assert.match(entrySource, /const pathname = new URL\(request\.url\)\.pathname/);
  assert.match(entrySource, /pathname === '\/api\/health'/);
  assert.match(entrySource, /request\.headers\.get\(INTERNAL_HEADER\) !== INTERNAL_VALUE/);
  assert.match(entrySource, /return core\.fetch\(/);
  assert.doesNotMatch(entrySource, /migrationFreezeEnabled/);
  assert.doesNotMatch(entrySource, /includes\('\/api\/status'\)/);
  assert.doesNotMatch(entrySource, /protectPrivateStatusResponse/);
});
