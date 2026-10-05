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

test('materialized L1 cache is bypassed after one minute even when the model itself is still fresh', async () => {
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

test('materialized L1 cache remains usable inside the five minute freshness window', async () => {
  const now = Date.UTC(2026, 8, 19, 0, 0);
  let r2Reads = 0;
  const response = await runPagesResponseFetch(request(), {}, {
    now: () => now,
    cache: {
      match: async () => materialized({ source: 'edge' }, now - 59_000),
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

test('unchanged older models are cached from the time R2 was checked', async () => {
  let now = Date.UTC(2026, 9, 2);
  const generatedAt = now - 3600_000;
  let saved;
  let reads = 0;
  const dependencies = {
    now: () => now,
    cache: {
      match: async () => saved?.clone(),
      put: async (_key, response) => { saved = response; },
    },
    loadR2Response: async () => {
      reads += 1;
      return materialized({ value: reads }, generatedAt);
    },
  };
  await runPagesResponseFetch(request(), {}, dependencies);
  now += 40_000;
  const cached = await runPagesResponseFetch(request(), {}, dependencies);
  assert.equal(reads, 1);
  assert.equal(cached.headers.get('x-materialized-at'), String(generatedAt));
  assert.equal(cached.headers.get('x-api-source'), 'edge-cache');
  now += 21_000;
  await runPagesResponseFetch(request(), {}, dependencies);
  assert.equal(reads, 2);
});

test('dashboard keeps its fifteen-second L1 freshness cap', async () => {
  const now = Date.UTC(2026, 9, 2);
  let reads = 0;
  const result = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=dashboard'),
    {},
    {
      now: () => now,
      cache: {
        match: async () => materialized({ source: 'edge' }, now - 16_000),
        put: async () => {},
      },
      loadR2Response: async () => {
        reads += 1;
        return materialized({ source: 'fresh-dashboard' }, now);
      },
    },
  );
  assert.equal(reads, 1);
  assert.deepEqual(await result.json(), { source: 'fresh-dashboard' });
});

test('a recent cache insertion cannot make an expired source fresh', async () => {
  const now = Date.UTC(2026, 9, 2);
  const expired = materialized({ source: 'expired' }, now - 365 * 86400_000);
  expired.headers.set('x-pages-edge-cached-at', String(now));
  let reads = 0;
  const result = await runPagesResponseFetch(new Request('https://internal.test/_internal/pages-response?key=dashboard'), {}, {
    now: () => now,
    cache: { match: async () => expired, put: async () => {} },
    loadR2Response: async () => { reads += 1; return materialized({ source: 'fresh' }, now); },
  });
  assert.equal(reads, 1);
  assert.deepEqual(await result.json(), { source: 'fresh' });
});
