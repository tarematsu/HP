import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequest } from '../functions/_middleware.js';

test('live dashboard bypasses the Pages edge cache', async () => {
  const previousCaches = globalThis.caches;
  let nextCalls = 0;
  let putCalls = 0;
  globalThis.caches = {
    default: {
      async match() { return null; },
      async put() { putCalls += 1; },
    },
  };

  try {
    const response = await onRequest({
      request: new Request('https://example.com/api/dashboard?history=0'),
      env: {},
      next: async () => {
        nextCalls += 1;
        return Response.json({ ok: true, latest: { observed_at: 123 } }, {
          headers: { 'cache-control': 'no-store' },
        });
      },
      waitUntil() {},
    });

    assert.equal(nextCalls, 1);
    assert.equal(putCalls, 0);
    assert.equal(response.headers.get('x-edge-cache'), 'BYPASS');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('hidden-tab dashboard cache has a bounded lifetime', () => {
  const source = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
  assert.match(source, /HIDDEN_CACHE_MAX_AGE_MS = 120_000/);
  assert.match(source, /Date\.now\(\) - state\.cachedAt > HIDDEN_CACHE_MAX_AGE_MS/);
  assert.match(source, /state\.cachedAt = Date\.now\(\)/);
});

test('dashboard refreshes resume from persisted delta state instead of rereading 24h history', () => {
  const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
  assert.match(entry, /import '\.\/dashboard-fetch-cache\.js\?v=20260731\.1'/);
  assert.match(source, /DASHBOARD_CACHE_KEY = 'sh\.dashboard\.v3'/);
  assert.match(source, /PERSISTED_CACHE_MAX_AGE_MS = 6 \* 60 \* 60_000/);
  assert.match(source, /function restorePersistedState\(\)/);
  assert.match(source, /localStorage\.getItem\(DASHBOARD_CACHE_KEY\)/);
  assert.match(source, /state\.latestObservedAt = latestObservedAt\(payload\)/);
  assert.match(source, /url\.searchParams\.set\('since', String\(state\.latestObservedAt\)\)/);
  assert.match(source, /url\.searchParams\.set\('queue_revision', state\.queueRevision\)/);
  assert.match(source, /if \(payload\.delta\)/);
  assert.match(source, /payload\.history = state\.history/);
  assert.match(source, /payload\.queue_unchanged && hasUsableQueue\(\)/);
});
