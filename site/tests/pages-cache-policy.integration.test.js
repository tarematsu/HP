import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequest } from '../functions/_middleware.js';

function recordingCache() {
  const writes = [];
  return {
    writes,
    async match() { return undefined; },
    async put(request, response) {
      writes.push({ request, response });
    },
  };
}

async function invokeWithOriginHeaders(headers) {
  const previousCaches = globalThis.caches;
  const cache = recordingCache();
  const waits = [];
  globalThis.caches = { default: cache };
  try {
    const response = await onRequest({
      request: new Request('https://skrzk.test/api/sakurazaka46jp?from=2026-07-01&to=2026-07-02'),
      env: {},
      next: async () => Response.json({ ok: true }, { headers }),
      waitUntil(promise) { waits.push(promise); },
    });
    await Promise.all(waits);
    return { response, writes: cache.writes };
  } finally {
    globalThis.caches = previousCaches;
  }
}

test('Pages edge cache respects an origin no-cache directive', async () => {
  const { response, writes } = await invokeWithOriginHeaders({
    'cache-control': 'public, no-cache',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-edge-cache'), 'BYPASS');
  assert.equal(response.headers.get('cache-control'), 'public, no-cache');
  assert.equal(writes.length, 0);
});

test('Pages edge cache does not store Vary wildcard responses', async () => {
  const { response, writes } = await invokeWithOriginHeaders({
    'cache-control': 'public, max-age=60',
    vary: '*',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-edge-cache'), 'BYPASS');
  assert.match(response.headers.get('vary') || '', /\*/);
  assert.equal(writes.length, 0);
});

test('Pages edge cache does not collapse unsupported Vary dimensions', async () => {
  const { response, writes } = await invokeWithOriginHeaders({
    'cache-control': 'public, max-age=60',
    vary: 'origin',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-edge-cache'), 'BYPASS');
  assert.equal(response.headers.get('vary'), 'origin, accept-encoding');
  assert.equal(writes.length, 0);
});

test('Pages edge cache still stores ordinary public JSON responses', async () => {
  const { response, writes } = await invokeWithOriginHeaders({
    'cache-control': 'public, max-age=60',
    vary: 'accept',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-edge-cache'), 'MISS');
  assert.match(response.headers.get('cache-control') || '', /s-maxage=300/);
  assert.equal(response.headers.get('vary'), 'accept, accept-encoding');
  assert.equal(writes.length, 1);
});
