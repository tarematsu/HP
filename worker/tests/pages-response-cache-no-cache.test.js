import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('Pages serving works when Cache API is unavailable', async () => {
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=history%3Adaily'),
    {},
    { cache: null, loadR2Response: async () => Response.json({ ok: true }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
