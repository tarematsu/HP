import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('track history metadata without version is rejected', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({ body: '{}', customMetadata: { updated_at: String(Date.now()) } }) }, 'track-history');
  assert.equal(response, null);
});
