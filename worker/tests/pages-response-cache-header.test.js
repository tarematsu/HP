import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('edge cache response preserves materialized timestamp', async () => {
  const stamp = String(Date.now());
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    { cache: { match: async () => new Response('{}', { headers: { 'x-materialized-at': stamp } }) } },
  );
  assert.equal(response.headers.get('x-materialized-at'), stamp);
});
