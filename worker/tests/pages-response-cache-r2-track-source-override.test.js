import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('track history source header is canonical', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}', customMetadata: { version: '1', updated_at: String(now), headers_json: '{"x-api-source":"old"}' },
  }) }, 'track-history', now, 60000);
  assert.equal(response.headers.get('x-api-source'), 'worker-r2');
});
