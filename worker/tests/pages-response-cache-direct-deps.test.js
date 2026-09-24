import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('direct dependency injection still supports cache hits', async () => {
  let reads = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    { cache: { match: async () => { reads += 1; return new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } }); } } },
  );
  assert.equal(response.status, 200);
  assert.equal(reads, 1);
});
