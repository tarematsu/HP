import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('edge cache response body is returned unchanged', async () => {
  const body = '{"cached":true}';
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    { cache: { match: async () => new Response(body, { headers: { 'x-materialized-at': String(Date.now()) } }) } },
  );
  assert.equal(await response.text(), body);
});
