import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('R2-only stale fallback remains marked stale and is not cached', async () => {
  const now = Date.now();
  let puts = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      now: () => now,
      cache: { match: async () => null, put: async () => { puts += 1; } },
      loadR2Response: async () => new Response('{}', { headers: { 'x-materialized-at': String(now - 86400000) } }),
    },
  );
  assert.equal(response.headers.get('x-materialized-stale'), '1');
  assert.equal(puts, 0);
});
