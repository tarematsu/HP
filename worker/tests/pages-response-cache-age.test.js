import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('edge cache age cap still rejects an old response', async () => {
  const now = Date.now();
  let r2Reads = 0;
  await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    { PAGES_RESPONSE_EDGE_CACHE_MAX_AGE_MS: 1000 },
    {
      now: () => now,
      cache: { match: async () => new Response('{}', { headers: { 'x-materialized-at': String(now - 1001) } }) },
      loadR2Response: async () => {
        r2Reads += 1;
        return new Response('{}', { headers: { 'x-materialized-at': String(now) } });
      },
    },
  );
  assert.equal(r2Reads, 1);
});
