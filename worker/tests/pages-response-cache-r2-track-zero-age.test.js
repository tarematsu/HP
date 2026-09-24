import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('zero maximum age accepts same-instant track history object', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}',
    customMetadata: { version: '1', updated_at: String(now) },
  }) }, 'track-history', now, 0);
  assert.equal(response.status, 200);
});
