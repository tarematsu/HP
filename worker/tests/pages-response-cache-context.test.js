import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('waitUntil context keeps injected dependencies active', async () => {
  let reads = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    { waitUntil() {} },
    {
      cache: { match: async () => null },
      loadR2Response: async () => { reads += 1; return Response.json({}); },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(reads, 1);
});
