import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('empty track history metadata is rejected', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({ body: '{}', customMetadata: {} }) }, 'track-history');
  assert.equal(response, null);
});
