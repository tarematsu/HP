import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMaterializedR2Response, pagesR2ResponseKey } from '../src/pages-response-r2.js';

test('track history materialized response performs one R2 get', async () => {
  let gets = 0;
  const now = Date.now();
  const r2 = { get: async (key) => {
    gets += 1;
    assert.equal(key, pagesR2ResponseKey('track-history'));
    return {
      body: '{}',
      customMetadata: { version: '1', status: '200', headers_json: '{}', updated_at: String(now) },
    };
  } };
  const response = await loadMaterializedR2Response(r2, 'track-history', now, 60000);
  assert.equal(response.status, 200);
  assert.equal(gets, 1);
});
