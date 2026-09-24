import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response, pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

test('Actions materialized response performs one R2 get', async () => {
  let gets = 0;
  const now = Date.now();
  const key = pagesActionsR2ResponseKey('history:daily');
  const r2 = { get: async (value) => {
    gets += 1;
    assert.equal(value, key);
    return { body: true, json: async () => ({ version: 1, updated_at: now, status: 200, headers: {}, body: '{}' }) };
  } };
  const response = await loadMaterializedR2Response(r2, 'history:daily', now, 60000);
  assert.equal(response.status, 200);
  assert.equal(gets, 1);
});
