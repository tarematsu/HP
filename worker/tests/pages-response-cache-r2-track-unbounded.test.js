import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('default maximum age remains effectively unbounded for track history', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}',
    customMetadata: { version: '1', updated_at: '1' },
  }) }, 'track-history', 2);
  assert.equal(response.status, 200);
});
