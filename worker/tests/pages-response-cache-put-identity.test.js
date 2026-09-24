import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('cache fill receives the exact request object by default', async () => {
  const request = new Request('https://internal.test/_internal/pages-response?key=history%3Adaily');
  let identity = false;
  await runPagesResponseFetch(request, {}, {
    cache: {
      match: async () => null,
      put: async (key) => { identity = key === request; },
    },
    loadR2Response: async () => new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } }),
  });
  assert.equal(identity, true);
});
