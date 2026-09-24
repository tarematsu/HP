import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('history daily remains R2-only after cache optimization', async () => {
  const calls = [];
  await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      cache: { match: async () => null },
      loadR2Response: async () => { calls.push('r2'); return Response.json({}); },
      loadResponse: async () => { calls.push('kv'); return Response.json({}); },
    },
  );
  assert.deepEqual(calls, ['r2']);
});
