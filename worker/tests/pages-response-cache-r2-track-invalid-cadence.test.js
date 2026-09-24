import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('invalid track history cadence is omitted', async () => {
  const now = Date.now();
  const response = await loadMaterializedR2Response({ get: async () => ({
    body: '{}',
    customMetadata: { version: '1', updated_at: String(now), cadence_seconds: 'bad' },
  }) }, 'track-history', now, 60000);
  assert.equal(response.headers.get('x-materialized-cadence-seconds'), null);
});
