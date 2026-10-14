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

const rangeUrl = (mode, query) => `https://pages-read-model.internal/_internal/pages-response?key=history:${mode}&${query}`;

function rangeCoordinator(rows) {
  let reads = 0;
  return {
    coordinator: new PagesHistoryApiCoordinator(null, {}, {
      async loadMaterializedResponse() {
        reads++;
        return Response.json({ ok: true, rows }, { headers: {
          'cache-control': 'public, max-age=30', 'x-materialized-at': String(Date.now()),
          'content-length': '999',
        } });
      },
    }),
    get reads() { return reads; },
  };
}

test('invalid history dates and reversed ranges reject before any storage read', async () => {
  const fixture = rangeCoordinator([]);
  for (const query of ['from=2026-02-30', 'from=2026-6-01', 'from=abc',
    'from=2026-07-01&to=2026-06-30']) {
    const response = await fixture.coordinator.fetch(new Request(rangeUrl('weekly', query)));
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(fixture.reads, 0);
  assert.equal((await fixture.coordinator.fetch(new Request(rangeUrl('unknown', 'from=2026-06-01')))).status, 404);
  assert.equal(fixture.reads, 0);
});

test('daily and weekly ranges include both period boundaries and allow one-sided ranges', async () => {
  for (const mode of ['daily', 'weekly']) {
    const fixture = rangeCoordinator(['2026-05-31', '2026-06-01', '2026-06-30', '2026-07-01']
      .map(period_key => ({ period_key })));
    for (const [query, expected] of [
      ['from=2026-06-01&to=2026-06-30', ['2026-06-01', '2026-06-30']],
      ['from=2026-06-30', ['2026-06-30', '2026-07-01']],
      ['to=2026-06-01', ['2026-05-31', '2026-06-01']],
    ]) {
      const response = await fixture.coordinator.fetch(new Request(rangeUrl(mode, query)));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-history-range-filter'), 'worker');
      assert.equal(response.headers.get('content-length'), null);
      assert.deepEqual((await response.json()).rows.map(row => row.period_key), expected);
    }
  }
});

test('broadcast range ends at exclusive UTC midnight following to date', async () => {
  const timestamps = ['2026-05-31T23:59:59.999Z', '2026-06-01T00:00:00Z',
    '2026-06-30T23:59:59.999Z', '2026-07-01T00:00:00Z'].map(Date.parse);
  const fixture = rangeCoordinator([...timestamps.map(started_at => ({ started_at })), { started_at: 'invalid' }]);
  const response = await fixture.coordinator.fetch(new Request(rangeUrl('broadcasts', 'from=2026-06-01&to=2026-06-30')));
  assert.deepEqual((await response.json()).rows.map(row => row.started_at), timestamps.slice(1, 3));
});

test('ranged response cache isolates date windows and cache hits skip coordinator', async () => {
  const fixture = rangeCoordinator(['2026-06-01', '2026-06-30'].map(period_key => ({ period_key })));
  const names = [];
  const cached = new Map();
  const pending = [];
  const env = { PAGES_HISTORY_API_COORDINATOR: {
    idFromName(name) { names.push(name); return name; },
    get() { return fixture.coordinator; },
  } };
  const deps = { responseCache: {
    async match(key) { return cached.get(key.url)?.clone(); },
    async put(key, response) { cached.set(key.url, response); },
  } };
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  for (const date of ['2026-06-01', '2026-06-30', '2026-06-01']) {
    const response = await runPagesResponseFetch(new Request(rangeUrl('daily', `from=${date}&to=${date}`)), env, ctx, deps);
    assert.deepEqual((await response.json()).rows.map(row => row.period_key), [date]);
    await Promise.all(pending);
  }
  assert.equal(fixture.reads, 2);
  assert.deepEqual(names, ['history:daily', 'history:daily']);
});

test('missing history DO fails closed without accessing R2 or assembling JSON', async () => {
  const env = { PAGES_RESPONSE_R2: { get() { throw new Error('HTTP must not read history shards'); } } };
  for (const requestUrl of [url(), rangeUrl('daily', 'from=2026-06-01')]) {
    const response = await runPagesResponseFetch(new Request(requestUrl), env);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('unavailable or malformed materialized history never returns an unfiltered success', async () => {
  for (const load of [async () => null, async () => Response.json({ ok: true }),
    async () => new Response('invalid JSON'), async () => { throw new Error('R2 unavailable'); }]) {
    const coordinator = new PagesHistoryApiCoordinator(null, {}, { loadMaterializedResponse: load });
    const response = await coordinator.fetch(new Request(rangeUrl('daily', 'from=2026-06-01')));
    assert.ok([404, 503].includes(response.status));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
