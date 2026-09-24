import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('Actions R2 response at freshness boundary remains usable', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: true,
    json: async () => ({ version: 1, updated_at: now - 1000, status: 200, headers: {}, body: '{}' }),
  }) }, 'history:daily', now, 1000);
  assert.equal(response.status, 200);
});
