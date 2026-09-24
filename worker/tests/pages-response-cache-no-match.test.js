import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('write-only cache adapter skips lookup and can fill', async () => {
  let puts = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      cache: { put: async () => { puts += 1; } },
      loadR2Response: async () => new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(puts, 1);
});
