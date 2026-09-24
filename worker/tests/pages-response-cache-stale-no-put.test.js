import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('stale R2 response is never written back to edge cache', async () => {
  const now = Date.now();
  let puts = 0;
  await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      now: () => now,
      cache: { match: async () => null, put: async () => { puts += 1; } },
      loadR2Response: async () => new Response('{}', { headers: { 'x-materialized-at': String(now - 8 * 86400000) } }),
    },
  );
  assert.equal(puts, 0);
});
