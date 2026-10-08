import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequest } from '../functions/_middleware.js';

test('dashboard fails closed without the materialized service and never reads live D1', async () => {
  let nextCalls = 0;
  const response = await onRequest({
    request: new Request('https://example.com/api/dashboard?history=0'),
    env: {},
    next: async () => {
      nextCalls += 1;
      return Response.json({ ok: true, latest: { observed_at: 123 } }, {
        headers: { 'cache-control': 'no-store' },
      });
    },
  });
  assert.equal(nextCalls, 0);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-materialized-required'), '1');
});

test('dashboard adapter has no browser-persisted or hidden-tab cache', () => {
  const source = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|CacheStorage|caches\.open|HIDDEN_CACHE_MAX_AGE_MS|PERSISTED_CACHE_MAX_AGE_MS/);
  assert.match(source, /const nativeFetch = window\.fetch\.bind\(window\)/);
  assert.match(source, /fetchDashboardWithRetry/);
});

test('shared Buddies adapter keeps only in-memory delta state between network reads', () => {
  const entry = browserSource('stationhead-channel-read-model.js');
  const adapter = browserSource('stationhead-channel-read-model.js');
  const source = readFileSync(new URL('../public/dashboard-fetch-cache.js', import.meta.url), 'utf8');
  assert.match(entry, /dashboard-fetch-cache\.js\?v=20260930\.1/);
  assert.match(adapter, /fetchJson\('\/api\/dashboard\?history=0'/);
  assert.doesNotMatch(adapter, /dashboard-details/);
  assert.match(source, /state\.latestObservedAt = Math\.max\(state\.latestObservedAt, latestObservedAt\(payload\)\)/);
  assert.match(source, /url\.searchParams\.set\('since', String\(state\.latestObservedAt\)\)/);
  assert.match(source, /url\.searchParams\.set\('queue_revision', state\.queueRevision\)/);
  assert.match(source, /if \(payload\.delta\)/);
  assert.match(source, /payload\.history = state\.history/);
  assert.match(source, /payload\.queue_unchanged && hasUsableQueue\(\)/);
});
