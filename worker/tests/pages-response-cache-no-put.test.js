import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('read-only cache adapter does not block storage response', async () => {
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      cache: { match: async () => null },
      loadR2Response: async () => new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } }),
    },
  );
  assert.equal(response.status, 200);
});
