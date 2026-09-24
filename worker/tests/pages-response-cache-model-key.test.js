import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('model key parsing remains trimmed', async () => {
  const calls = [];
  await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=%20history%3Adaily%20'),
    {},
    { loadR2Response: async (_r2, key) => { calls.push(key); return Response.json({}); } },
  );
  assert.deepEqual(calls, ['history:daily']);
});
