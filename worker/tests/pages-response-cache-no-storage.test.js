import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('fresh edge-cache hit performs no R2 or KV read', async () => {
  const request = new Request('https://internal.test/_internal/pages-response?key=history%3Adaily');
  let storageReads = 0;
  const response = await runPagesResponseFetch(request, {}, {
    cache: {
      match: async () => new Response('{}', {
        headers: { 'x-materialized-at': String(Date.now()) },
      }),
    },
    loadR2Response: async () => { storageReads += 1; return null; },
    loadResponse: async () => { storageReads += 1; return null; },
  });
  assert.equal(response.status, 200);
  assert.equal(storageReads, 0);
  assert.equal(response.headers.get('x-api-source'), 'edge-cache');
});
