import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequest } from '../functions/_middleware.js';

const CASES = [
  ['history:daily', '/api/history?mode=daily'],
  ['history:weekly', '/api/history?mode=weekly'],
  ['history:monthly', '/api/history?mode=monthly'],
  ['history:broadcasts', '/api/history?mode=broadcasts'],
  ['host-history:summary', '/api/host-history?mode=summary'],
];

test('completed history models fail closed instead of reading live Pages databases', async () => {
  const originalCaches = globalThis.caches;
  let cacheWrites = 0;
  globalThis.caches = {
    default: {
      async match() { return undefined; },
      async put() { cacheWrites += 1; },
    },
  };

  try {
    for (const [modelKey, path] of CASES) {
      let serviceCalls = 0;
      let liveCalls = 0;
      const response = await onRequest({
        request: new Request(`https://skrzk.test${path}`),
        env: {
          PAGES_READ_MODEL_SERVICE: {
            async fetch(request) {
              serviceCalls += 1;
              assert.equal(new URL(request.url).searchParams.get('key'), modelKey);
              return Response.json({ ok: false }, { status: 503 });
            },
          },
        },
        async next() {
          liveCalls += 1;
          return Response.json({ ok: true, source: 'must-not-run' });
        },
        waitUntil() {},
      });

      assert.equal(response.status, 503, modelKey);
      assert.equal(response.headers.get('x-materialized-required'), '1', modelKey);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: 'materialized response unavailable',
        model_key: modelKey,
      });
      assert.equal(serviceCalls, 1, modelKey);
      assert.equal(liveCalls, 0, modelKey);
    }
    assert.equal(cacheWrites, 0);
  } finally {
    globalThis.caches = originalCaches;
  }
});
