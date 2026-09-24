import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('non-GET requests are rejected before cache access', async () => {
  let cacheReads = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily', { method: 'POST' }),
    {},
    { cache: { match: async () => { cacheReads += 1; return null; } } },
  );
  assert.equal(response.status, 404);
  assert.equal(cacheReads, 0);
});
