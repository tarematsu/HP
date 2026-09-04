import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

function historyRequest() {
  return new Request('https://internal.test/_internal/pages-response?key=history%3Adaily');
}

test('expired completed history uses one bounded stale R2 read without KV or cache writes', async () => {
  const now = Date.UTC(2026, 7, 31, 23, 30);
  const updatedAt = now - 24 * 60 * 60 * 1000;
  const maximumAges = [];
  let cacheWrites = 0;
  const response = await runPagesResponseFetch(
    historyRequest(),
    {},
    {
      now: () => now,
      cache: {
        match: async () => null,
        put: async () => { cacheWrites += 1; },
      },
      loadR2Response: async (_r2, modelKey, requestedNow, maximumAge) => {
        assert.equal(modelKey, 'history:daily');
        assert.equal(requestedNow, now);
        maximumAges.push(maximumAge);
        const stale = Response.json({ ok: true, source: 'stale-r2' });
        stale.headers.set('x-materialized-at', String(updatedAt));
        stale.headers.set('x-materialized-cadence-seconds', '21600');
        return stale;
      },
      loadResponse: async () => {
        throw new Error('completed history must not consult KV');
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, source: 'stale-r2' });
  assert.equal(response.headers.get('x-materialized-stale'), '1');
  assert.deepEqual(maximumAges, [7 * 24 * 60 * 60 * 1000]);
  assert.equal(cacheWrites, 0);
});

test('fresh completed history remains the preferred single R2 response', async () => {
  let reads = 0;
  const response = await runPagesResponseFetch(
    historyRequest(),
    {},
    {
      loadR2Response: async () => {
        reads += 1;
        return Response.json({ ok: true, source: 'fresh-r2' });
      },
      loadResponse: async () => {
        throw new Error('completed history must not consult KV');
      },
    },
  );

  assert.equal(reads, 1);
  assert.equal(response.headers.get('x-materialized-stale'), null);
  assert.deepEqual(await response.json(), { ok: true, source: 'fresh-r2' });
});
