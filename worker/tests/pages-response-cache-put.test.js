import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('fresh storage response is populated into edge cache', async () => {
  let puts = 0;
  await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      cache: { match: async () => null, put: async () => { puts += 1; } },
      loadR2Response: async () => new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } }),
    },
  );
  assert.equal(puts, 1);
});
