import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('zero Actions status falls back to 200', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({ body: true, json: async () => ({ version: 1, updated_at: now, status: 0, body: '{}' }) }) }, 'history:daily', now, 60000);
  assert.equal(response.status, 200);
});
