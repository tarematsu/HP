import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response } from '../src/pages-response-r2.js';

test('malformed Actions envelope stops after one R2 get', async () => {
  let gets = 0;
  const response = await loadMaterializedR2Response({ get: async () => {
    gets += 1;
    return { body: true, json: async () => { throw new Error('bad json'); } };
  } }, 'history:daily');
  assert.equal(response, null);
  assert.equal(gets, 1);
});
