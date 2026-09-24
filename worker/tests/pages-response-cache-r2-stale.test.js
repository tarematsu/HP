import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('stale Actions response stops after one R2 get', async () => {
  let gets = 0;
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => {
    gets += 1;
    return { body: true, json: async () => ({ version: 1, updated_at: now - 10000, body: '{}' }) };
  } }, 'history:daily', now, 1000);
  assert.equal(response, null);
  assert.equal(gets, 1);
});
