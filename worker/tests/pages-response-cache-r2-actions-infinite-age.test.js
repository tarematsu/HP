import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('infinite maximum age does not reject a valid Actions object', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({ body: true, json: async () => ({ version: 1, updated_at: 1, body: '{}' }) }) }, 'history:daily', 1000, Infinity);
  assert.equal(response.status, 200);
});
