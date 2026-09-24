import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('Actions object without body is treated as a miss', async () => {
  const response = await loadMaterializedR2Response({ get: async () => ({ json: async () => ({}) }) }, 'history:daily');
  assert.equal(response, null);
});
