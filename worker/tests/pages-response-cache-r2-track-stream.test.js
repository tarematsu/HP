import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('track history R2 body is passed through', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: 'payload', customMetadata: { version: '1', updated_at: String(now) },
  }) }, 'track-history', now, 60000);
  assert.equal(await response.text(), 'payload');
});
