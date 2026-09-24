import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('track history R2 response retains cadence', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}',
    customMetadata: { version: '1', status: '200', headers_json: '{}', updated_at: String(now), cadence_seconds: '300' },
  }) }, 'track-history', now, 60000);
  assert.equal(response.headers.get('x-materialized-cadence-seconds'), '300');
});
