import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('edge cache read failure falls through to storage', async () => {
  let r2Reads = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      cache: { match: async () => { throw new Error('cache unavailable'); } },
      loadR2Response: async () => {
        r2Reads += 1;
        return new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } });
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(r2Reads, 1);
});
