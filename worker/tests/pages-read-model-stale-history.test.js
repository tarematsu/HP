import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

function historyRequest() {
  return new Request('https://internal.test/_internal/pages-response?key=history%3Adaily');
}

test('expired completed history falls back to bounded stale R2 without touching D1 or KV', async () => {
  const now = Date.UTC(2026, 7, 31, 23, 30);
  const updatedAt = now - 24 * 60 * 60 * 1000;
  const maximumAges = [];
  const response = await runPagesResponseFetch(
    historyRequest(),
    {},
    {
      now: () => now,
      loadR2Response: async (_r2, modelKey, requestedNow, maximumAge) => {
        assert.equal(modelKey, 'history:daily');
        assert.equal(requestedNow, now);
        maximumAges.push(maximumAge);
        if (maximumAges.length === 1) return null;
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
  assert.equal(maximumAges.length, 2);
  assert.ok(maximumAges[1] > maximumAges[0]);
  assert.equal(maximumAges[1], 7 * 24 * 60 * 60 * 1000);
});

test('fresh completed history remains the preferred R2 response', async () => {
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
