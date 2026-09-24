import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('track history cache miss still falls back from R2 to KV', async () => {
  const calls = [];
  await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=track-history'),
    {},
    {
      cache: { match: async () => null },
      loadR2Response: async () => { calls.push('r2'); return null; },
      loadResponse: async () => { calls.push('kv'); return Response.json({}); },
    },
  );
  assert.deepEqual(calls, ['r2', 'kv']);
});
