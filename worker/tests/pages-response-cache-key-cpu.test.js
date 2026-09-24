import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

const source = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');

test('Pages hot path reuses the incoming Request as the default cache key', async () => {
  const request = new Request('https://internal.test/_internal/pages-response?key=history%3Adaily');
  let matchedKey;
  const cached = new Response('{}', {
    headers: { 'x-materialized-at': String(Date.now()) },
  });
  const response = await runPagesResponseFetch(request, {}, {
    cache: {
      match: async (key) => { matchedKey = key; return cached; },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(matchedKey, request);
  assert.doesNotMatch(source, /new Request\(request\.url, \{ method: 'GET' \}\)/);
});

test('custom cache key remains supported for tests and adapters', async () => {
  const request = new Request('https://internal.test/_internal/pages-response?key=history%3Adaily');
  const custom = new Request('https://cache.test/custom');
  let matchedKey;
  await runPagesResponseFetch(request, {}, {
    cacheKey: () => custom,
    cache: {
      match: async (key) => {
        matchedKey = key;
        return new Response('{}', { headers: { 'x-materialized-at': String(Date.now()) } });
      },
    },
  });
  assert.equal(matchedKey, custom);
});
