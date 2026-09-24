import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('Actions R2 cadence remains exposed', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: true,
    json: async () => ({ version: 1, updated_at: now, cadence_seconds: 60, status: 200, headers: {}, body: '{}' }),
  }) }, 'history:daily', now, 60000);
  assert.equal(response.headers.get('x-materialized-cadence-seconds'), '60');
});
