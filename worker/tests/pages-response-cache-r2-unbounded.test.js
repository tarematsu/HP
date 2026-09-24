import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('default maximum age remains effectively unbounded', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: true,
    json: async () => ({ version: 1, updated_at: 1, status: 200, headers: {}, body: '{}' }),
  }) }, 'history:daily', 2);
  assert.equal(response.status, 200);
});
