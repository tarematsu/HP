import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('deferred edge cache write failure does not fail the response', async () => {
  let deferred;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    { waitUntil(promise) { deferred = promise; } },
    {
      cache: {
        match: async () => null,
        put: async () => { throw new Error('cache write unavailable'); },
      },
      loadR2Response: async () => new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } }),
    },
  );
  assert.equal(response.status, 200);
  await deferred;
});
