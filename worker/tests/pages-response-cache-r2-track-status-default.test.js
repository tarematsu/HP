import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('absent track history status defaults to 200', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}', customMetadata: { version: '1', updated_at: String(now) },
  }) }, 'track-history', now, 60000);
  assert.equal(response.status, 200);
});
