import assert from 'node:assert/strict';
import test from 'node:test';
import { PagesHistoryApiCoordinator } from '../src/pages-history-api-coordinator.js';
import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';

const url = (query = 'source=buddies') => `https://pages-read-model.internal/_internal/pages-response?key=track-history&api=1&${query}`;

test('Pages HTTP delegates cold history CPU to one source-scoped Durable Object', async () => {
  const names = [];
  const calls = [];
  const cached = new Map();
  const pending = [];
  const env = { PAGES_RESPONSE_R2: {}, PAGES_HISTORY_API_COORDINATOR: {
    idFromName(name) { names.push(name); return name; },
    get(name) { return {
      async fetch(request) {
        calls.push({ name, url: request.url });
        return new Response(JSON.stringify({ name, count: calls.length }), {
          headers: { 'content-type': 'application/json', 'cache-control': 'public,max-age=300' },
        });
      },
    }; },
  } };
  const deps = { responseCache: {
    async match(key) { return cached.get(key.url)?.clone(); },
    async put(key, response) { cached.set(key.url, response.clone()); },
  } };
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  const first = await runPagesResponseFetch(new Request(url()), env, ctx, deps);
  assert.deepEqual(await first.json(), { name: 'history:buddies', count: 1 });
  await Promise.all(pending);
  const hit = await runPagesResponseFetch(new Request(url()), env, ctx, deps);
  assert.deepEqual(await hit.json(), { name: 'history:buddies', count: 1 });
  assert.equal(calls.length, 1, 'cache hit must avoid Durable Object');
  assert.deepEqual(names, ['history:buddies']);
  const other = await runPagesResponseFetch(new Request(url('source=ohisama')), env, ctx, deps);
  assert.equal((await other.json()).name, 'history:ohisama');
  assert.equal(calls.length, 2);
});

test('DO transport failure is contained without assembling large JSON on 10ms HTTP path', async () => {
  let warned = 0;
  const originalError = console.error;
  console.error = () => { warned++; };
  try {
    const env = { PAGES_HISTORY_API_COORDINATOR: {
      idFromName() { return 'history:buddies'; },
      get() { return { async fetch() { throw new Error('DO unavailable'); } }; },
    } };
    const response = await runPagesResponseFetch(new Request(url()), env, { responseCache: null });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '30');
    assert.equal(warned, 1);
  } finally { console.error = originalError; }
});

test('DO returns the existing track-history API response and rejects unrelated paths', async () => {
  const bucket = {};
  const calls = [];
  const env = { PAGES_RESPONSE_R2: bucket };
  const coordinator = new PagesHistoryApiCoordinator(null, env, {
    now: () => 1_700_000_000_000,
    async loadTrackHistoryR2ApiResponse(r2, request, now, maxAge) {
      calls.push({ r2, url: request.url, now, maxAge });
      return Response.json({ ok: true, source: new URL(request.url).searchParams.get('source') || 'buddies' });
    },
  });
  assert.deepEqual(await (await coordinator.fetch(new Request(url()))).json(), {
    ok: true, source: 'buddies',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].r2, bucket);
  assert.equal(calls[0].now, 1_700_000_000_000);
  assert.ok(calls[0].maxAge >= 7 * 24 * 60 * 60_000);
  assert.equal((await coordinator.fetch(new Request('https://x.test/unrelated'))).status, 404);
  assert.equal((await coordinator.fetch(new Request(url(), { method: 'POST' }))).status, 405);
  assert.equal((await coordinator.fetch(new Request(url('source=unknown')))).status, 400);
  assert.equal(calls.length, 1);
});
