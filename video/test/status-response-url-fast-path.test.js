import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import core from '../src/entry-core.js';
import entry from '../src/entry.js';

const entrySource = await readFile(new URL('../src/entry.js', import.meta.url), 'utf8');

test('normal requests bypass entry-level URL parsing', () => {
  assert.notEqual(entry, core);
  assert.match(
    entrySource,
    /migrationFreezeEnabled\(env\) && new URL\(request\.url\)\.pathname\.startsWith\('\/api\/'\)/
  );
  assert.doesNotMatch(entrySource, /includes\('\/api\/status'\)/);
  assert.doesNotMatch(entrySource, /protectPrivateStatusResponse/);
});
