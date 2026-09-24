import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('numeric track history cadence is normalized', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}', customMetadata: { version: '1', updated_at: String(now), cadence_seconds: 60 },
  }) }, 'track-history', now, 60000);
  assert.equal(response.headers.get('x-materialized-cadence-seconds'), '60');
});
