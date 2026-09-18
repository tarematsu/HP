import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

const request = () => new Request('https://internal.test/_internal/pages-response?key=history%3Adaily');

function materialized(body, updatedAt) {
  const response = Response.json(body);
  response.headers.set('x-materialized-at', String(updatedAt));
  response.headers.set('x-materialized-cadence-seconds', '21600');
  return response;
}

test('materialized L1 cache is bypassed after sixty seconds even when the model itself is still fresh', async () => {
  const now = Date.UTC(2026, 8, 19, 0, 0);
  let r2Reads = 0;
  let cacheWrites = 0;
  const response = await runPagesResponseFetch(request(), {}, {
    now: () => now,
    cache: {
      match: async () => materialized({ source: 'old-edge' }, now - 61_000),
      put: async () => { cacheWrites += 1; },
    },
    loadR2Response: async () => {
      r2Reads += 1;
      return materialized({ source: 'new-r2' }, now);
    },
  });

  assert.equal(r2Reads, 1);
  assert.equal(cacheWrites, 1);
  assert.equal(response.headers.get('x-api-source'), null);
  assert.deepEqual(await response.json(), { source: 'new-r2' });
});

test('materialized L1 cache remains usable inside the sixty second freshness window', async () => {
  const now = Date.UTC(2026, 8, 19, 0, 0);
  let r2Reads = 0;
  const response = await runPagesResponseFetch(request(), {}, {
    now: () => now,
    cache: {
      match: async () => materialized({ source: 'edge' }, now - 30_000),
      put: async () => {},
    },
    loadR2Response: async () => {
      r2Reads += 1;
      return materialized({ source: 'r2' }, now);
    },
  });

  assert.equal(r2Reads, 0);
  assert.equal(response.headers.get('x-api-source'), 'edge-cache');
  assert.deepEqual(await response.json(), { source: 'edge' });
});
