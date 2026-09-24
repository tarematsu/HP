import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('dashboard cache miss still prefers KV before R2', async () => {
  const calls = [];
  await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=dashboard'),
    {},
    {
      cache: { match: async () => null },
      loadResponse: async () => { calls.push('kv'); return Response.json({}); },
      loadR2Response: async () => { calls.push('r2'); return Response.json({}); },
    },
  );
  assert.deepEqual(calls, ['kv']);
});
