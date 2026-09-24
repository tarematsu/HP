import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('missing model key exits before cache work', async () => {
  let cacheReads = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response'),
    {},
    { cache: { match: async () => { cacheReads += 1; return null; } } },
  );
  assert.equal(response.status, 400);
  assert.equal(cacheReads, 0);
});
