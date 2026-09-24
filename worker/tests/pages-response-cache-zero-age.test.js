import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('zero edge cache age accepts only same-instant materialization', async () => {
  const now = Date.now();
  let r2Reads = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    { PAGES_RESPONSE_EDGE_CACHE_MAX_AGE_MS: 0 },
    {
      now: () => now,
      cache: { match: async () => new Response('{}', { headers: { 'x-materialized-at': String(now) } }) },
      loadR2Response: async () => { r2Reads += 1; return null; },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(r2Reads, 0);
});
