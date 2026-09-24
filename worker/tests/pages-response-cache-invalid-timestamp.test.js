import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('invalid materialized timestamp falls through to storage', async () => {
  let r2Reads = 0;
  await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      cache: { match: async () => new Response('{}', { headers: { 'x-materialized-at': 'invalid' } }) },
      loadR2Response: async () => { r2Reads += 1; return Response.json({}); },
    },
  );
  assert.equal(r2Reads, 1);
});
