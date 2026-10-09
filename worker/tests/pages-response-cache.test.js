import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheablePagesResponse } from '../src/pages-response-cache.js';
import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

test('canonical cache respects public lifetime and freshness, excludes errors/private/stale responses', () => {
  const response = new Response('{}', { headers: { 'cache-control': 'public, max-age=30, s-maxage=300', 'x-materialized-at': '1000' } });
  assert.equal(cacheablePagesResponse(response, 1000, 100000).headers.get('cache-control'), 'public, max-age=100, s-maxage=100');
  assert.equal(cacheablePagesResponse(response, 102000, 100000), null);
  for (const policy of ['no-store', 'private, max-age=300', 'public, no-cache', 'public, max-age=0']) {
    assert.equal(cacheablePagesResponse(new Response('{}', { headers: { 'cache-control': policy } }), 1000, 100000), null);
  }
  assert.equal(cacheablePagesResponse(new Response(null, { status: 503 }), 1000, 100000), null);
});

test('canonical model cache avoids repeated R2 reads and isolates keys', async () => {
  const objects = new Map();
  const pending = [];
  let reads = 0;
  const context = { waitUntil(promise) { pending.push(promise); } };
  const dependencies = {
    now: () => 1000,
    responseCache: { async match(key) { return objects.get(key.url)?.clone(); }, async put(key, response) { objects.set(key.url, response); } },
    async loadR2Response() { reads++; return new Response('{}', { headers: { 'cache-control': 'public, max-age=30', 'x-materialized-at': '1000' } }); },
  };
  const fetch = key => runPagesResponseFetch(new Request(`https://pages-read-model.internal/_internal/pages-response?key=${key}`), {}, context, dependencies);
  await fetch('leaderboard');
  await Promise.all(pending);
  await fetch('leaderboard');
  assert.equal(reads, 1);
  await fetch('apple-music');
  assert.equal(reads, 2);
  dependencies.responseCache.match = async () => { throw new Error('cache unavailable'); };
  assert.equal((await fetch('leaderboard')).status, 200);
  assert.equal(reads, 3);
});
