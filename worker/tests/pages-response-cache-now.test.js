import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('serving request samples injected clock once', async () => {
  let calls = 0;
  await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    {
      now: () => { calls += 1; return Date.now(); },
      cache: { match: async () => new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } }) },
    },
  );
  assert.equal(calls, 1);
});
