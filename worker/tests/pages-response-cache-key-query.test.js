import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('default cache key retains the model query string', async () => {
  const request = new Request('https://internal.test/_internal/pages-response?key=current');
  let keyUrl;
  await runPagesResponseFetch(request, {}, {
    cache: { match: async (key) => {
      keyUrl = key.url;
      return new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } });
    } },
  });
  assert.equal(keyUrl, request.url);
});
