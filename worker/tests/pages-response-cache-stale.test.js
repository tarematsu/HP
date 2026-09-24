import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('stale edge-cache entry falls through to canonical R2 response', async () => {
  const now = Date.now();
  let r2Reads = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      now: () => now,
      cache: {
        match: async () => new Response('{"old":true}', {
          headers: { 'x-materialized-at': String(now - 120000) },
        }),
      },
      loadR2Response: async () => {
        r2Reads += 1;
        return new Response('{"old":false}', {
          headers: { 'x-materialized-at': String(now) },
        });
      },
    },
  );
  assert.equal(r2Reads, 1);
  assert.deepEqual(await response.json(), { old: false });
});
