import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('negative Actions R2 timestamp is rejected', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: true,
    json: async () => ({ version: 1, updated_at: -1, status: 200, headers: {}, body: '{}' }),
  }) }, 'history:daily');
  assert.equal(response, null);
});
