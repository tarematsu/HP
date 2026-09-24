import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('edge cache hit is explicitly identified', async () => {
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      cache: { match: async () => new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } }) },
    },
  );
  assert.equal(response.headers.get('x-api-source'), 'edge-cache');
});
