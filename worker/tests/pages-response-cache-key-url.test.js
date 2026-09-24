import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('default edge cache key preserves exact internal URL identity', async () => {
  const request = new Request('https://pages-read-model.internal/_internal/pages-response?key=current');
  let key;
  await runPagesResponseFetch(request, {}, {
    cache: {
      match: async (value) => {
        key = value;
        return new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } });
      },
    },
  });
  assert.equal(key.url, request.url);
  assert.equal(key.method, 'GET');
});
