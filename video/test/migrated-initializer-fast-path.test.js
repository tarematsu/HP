import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureDatabaseOnce } from '../src/db-init.js';

test('migrated initializer guards return synchronously without allocating a promise', () => {
  let initialized = false;
  const result = ensureDatabaseOnce(
    {},
    'video-blocklist-schema',
    () => { initialized = true; }
  );

  assert.equal(result, undefined);
  assert.equal(initialized, false);
});