import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('custom cache key is evaluated once per request', async () => {
  let calls = 0;
  await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      cacheKey: (request) => { calls += 1; return request; },
      cache: { match: async () => new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } }) },
    },
  );
  assert.equal(calls, 1);
});
