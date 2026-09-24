import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('track history metadata without updated timestamp is rejected', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({ body: '{}', customMetadata: { version: '1' } }) }, 'track-history');
  assert.equal(response, null);
});
