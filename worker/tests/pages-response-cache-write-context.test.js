import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('Pages cache fill reuses the incoming Request and defers put with waitUntil', async () => {
  const request = new Request('https://internal.test/_internal/pages-response?key=history%3Adaily');
  let putKey;
  let deferred;
  const context = { waitUntil(promise) { deferred = promise; } };
  const response = await runPagesResponseFetch(request, {}, context, {
    cache: {
      match: async () => null,
      put: async (key) => { putKey = key; },
    },
    loadR2Response: async () => new Response('{}', {
      headers: { 'x-materialized-at': String(Date.now()) },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(putKey, request);
  await deferred;
});
