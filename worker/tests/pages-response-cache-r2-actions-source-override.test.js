import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('Actions source header is canonical', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: true, json: async () => ({ version: 1, updated_at: now, headers: { 'x-api-source': 'old' }, body: '{}' }),
  }) }, 'history:daily', now, 60000);
  assert.equal(response.headers.get('x-api-source'), 'actions-r2');
});
