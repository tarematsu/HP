import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('Actions R2 body remains preserved', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: true,
    json: async () => ({ version: 1, updated_at: now, status: 200, headers: {}, body: '{"ok":true}' }),
  }) }, 'history:daily', now, 60000);
  assert.deepEqual(await response.json(), { ok: true });
});
