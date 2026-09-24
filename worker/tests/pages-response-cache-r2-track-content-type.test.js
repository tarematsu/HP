import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('track history persisted content type is preserved', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}', customMetadata: { version: '1', updated_at: String(now), headers_json: '{"content-type":"application/json"}' },
  }) }, 'track-history', now, 60000);
  assert.equal(response.headers.get('content-type'), 'application/json');
});
