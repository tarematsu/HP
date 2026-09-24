import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('R2-only cache miss uses exactly one storage read', async () => {
  let r2Reads = 0;
  let kvReads = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      cache: { match: async () => null },
      loadR2Response: async () => { r2Reads += 1; return Response.json({ ok: true }); },
      loadResponse: async () => { kvReads += 1; return null; },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(r2Reads, 1);
  assert.equal(kvReads, 0);
});
