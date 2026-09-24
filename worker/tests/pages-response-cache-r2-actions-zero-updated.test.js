import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('zero Actions updated timestamp remains valid when within age', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({ body: true, json: async () => ({ version: 1, updated_at: 0, body: '{}' }) }) }, 'history:daily', 0, 0);
  assert.equal(response.status, 200);
});
