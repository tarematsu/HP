import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('invalid track history updated timestamp is rejected', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}',
    customMetadata: { version: '1', updated_at: 'bad' },
  }) }, 'track-history');
  assert.equal(response, null);
});
