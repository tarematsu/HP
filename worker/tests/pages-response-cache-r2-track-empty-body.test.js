import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('empty-string track history object body is treated as a miss', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({ body: '', customMetadata: { version: '1', updated_at: String(Date.now()) } }) }, 'track-history');
  assert.equal(response, null);
});
