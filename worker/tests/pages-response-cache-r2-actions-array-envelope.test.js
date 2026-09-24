import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('array Actions envelope is rejected', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({ body: true, json: async () => [] }) }, 'history:daily');
  assert.equal(response, null);
});
