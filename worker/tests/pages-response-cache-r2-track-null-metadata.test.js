import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('null track history metadata is treated as a miss', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({ body: '{}', customMetadata: null }) }, 'track-history');
  assert.equal(response, null);
});
