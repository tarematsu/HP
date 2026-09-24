import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('stale track history object stops after one R2 get', async () => {
  let gets = 0;
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => {
    gets += 1;
    return { body: '{}', customMetadata: { version: '1', updated_at: String(now - 10000) } };
  } }, 'track-history', now, 1000);
  assert.equal(response, null);
  assert.equal(gets, 1);
});
