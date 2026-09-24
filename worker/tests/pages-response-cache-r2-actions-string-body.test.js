import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('Actions string body remains unchanged', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({ body: true, json: async () => ({ version: 1, updated_at: now, body: 'abc' }) }) }, 'history:daily', now, 60000);
  assert.equal(await response.text(), 'abc');
});
