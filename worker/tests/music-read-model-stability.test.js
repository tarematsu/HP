import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

for (const modelKey of ['apple-music', 'amazon-music']) {
  test(`${modelKey} is served directly from non-expiring producer R2 without KV fallback`, async () => {
    let r2Calls = 0;
    let kvCalls = 0;
    let seenMaximumAge = null;
    const now = Date.UTC(2026, 8, 30, 10, 0, 0);

    const response = await runPagesResponseFetch(
      new Request(`https://internal.test/_internal/pages-response?key=${encodeURIComponent(modelKey)}`),
      { PAGES_RESPONSE_R2: {}, PAGES_RESPONSE_KV: {} },
      {
        now: () => now,
        loadR2Response: async (_r2, key, _now, maximumAge) => {
          r2Calls += 1;
          seenMaximumAge = maximumAge;
          assert.equal(key, modelKey);
          return new Response(JSON.stringify({ ok: true, key }), {
            headers: {
              'content-type': 'application/json',
              'x-materialized-at': '1',
            },
          });
        },
        loadResponse: async () => {
          kvCalls += 1;
          return null;
        },
      },
    );

    assert.equal(response.status, 200);
    assert.equal(r2Calls, 1);
    assert.equal(kvCalls, 0);
    assert.equal(seenMaximumAge, Number.MAX_SAFE_INTEGER);
    assert.equal(response.headers.get('x-materialized-stale'), null);
    assert.deepEqual(await response.json(), { ok: true, key: modelKey });
  });
}

test('Amazon replacement scans keep the previous complete ranks until the new scan completes', () => {
  const source = readFileSync(new URL('../src/amazon-music-pipeline.js', import.meta.url), 'utf8');
  assert.match(source, /resetRanks: complete/);
  assert.doesNotMatch(source, /resetRanks\s*=\s*true/);
});
