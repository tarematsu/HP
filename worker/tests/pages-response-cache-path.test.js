import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('wrong internal path exits before cache work', async () => {
  let cacheReads = 0;
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/not-pages-response?key=history%3Adaily'),
    {},
    { cache: { match: async () => { cacheReads += 1; return null; } } },
  );
  assert.equal(response.status, 404);
  assert.equal(cacheReads, 0);
});
