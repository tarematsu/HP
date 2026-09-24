import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('track history R2 response at freshness boundary remains usable', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}',
    customMetadata: { version: '1', status: '200', headers_json: '{}', updated_at: String(now - 1000) },
  }) }, 'track-history', now, 1000);
  assert.equal(response.status, 200);
});
