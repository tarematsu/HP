import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('negative track history R2 timestamp is rejected', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}',
    customMetadata: { version: '1', updated_at: '-1' },
  }) }, 'track-history');
  assert.equal(response, null);
});
