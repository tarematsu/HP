import assert from 'node:assert/strict';
import test from 'node:test';
import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

function fixture() {
  const objects = new Map();
  const pending = [];
  const context = { waitUntil(promise) { pending.push(promise); } };
  const responseCache = {
    async match(key) { return objects.get(key.url)?.clone(); },
    async put(key, value) { objects.set(key.url, value); },
  };
  let calls = 0;
  const dependencies = { responseCache, async loadTrackHistoryApiResponse() {
    calls++;
    return new Response(JSON.stringify({ calls }), { headers: { 'cache-control': 'public, max-age=300' } });
  } };
  const fetch = query => runPagesResponseFetch(new Request(`https://pages-read-model.internal/_internal/pages-response?key=track-history&api=1&${query}`), {}, context, dependencies);
  return { fetch, dependencies, pending, calls: () => calls };
}

test('repeated track-history API requests reuse cache without recomputing JSON', async () => {
  const f = fixture();
  assert.deepEqual(await (await f.fetch('source=buddies&ranking_only=1')).json(), { calls: 1 });
  await Promise.all(f.pending);
  assert.deepEqual(await (await f.fetch('source=buddies&ranking_only=1')).json(), { calls: 1 });
  assert.equal(f.calls(), 1);
  await f.fetch('source=ohisama&ranking_only=1');
  await f.fetch('source=buddies&ranking_only=1&ranking_limit=20');
  await f.fetch('source=buddies&ranking_only=1&invalid=1');
  assert.equal(f.calls(), 4);
});

test('unavailable models are not cached and storage cache failure falls back to R2', async () => {
  const f = fixture();
  f.dependencies.loadTrackHistoryApiResponse = async () => new Response(null, { status: 503 });
  assert.equal((await f.fetch('')).status, 503);
  assert.equal(f.pending.length, 0);
  f.dependencies.responseCache.match = async () => { throw new Error('cache unavailable'); };
  f.dependencies.loadTrackHistoryApiResponse = async () => new Response('{}');
  f.dependencies.responseCache.put = async () => { throw new Error('cache unavailable'); };
  assert.equal((await f.fetch('')).status, 200);
  await Promise.all(f.pending);
});
