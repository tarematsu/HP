import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('zero track history updated timestamp remains valid when within age', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({ body: '{}', customMetadata: { version: '1', updated_at: '0' } }) }, 'track-history', 0, 0);
  assert.equal(response.status, 200);
});
