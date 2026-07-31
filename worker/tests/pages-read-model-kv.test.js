import assert from 'node:assert/strict';
import test from 'node:test';

import { runPagesResponseFetch } from '../src/pages-response-fetch-entry.js';
import {
  loadMaterializedResponse,
  pagesResponseKey,
  saveMaterializedResponse,
} from '../src/pages-response-store.js';
import {
  ensurePagesResponseNamespace,
  namespaceIdFromList,
  pagesReadModelConfigWithNamespaceId,
} from '../scripts/pages-response-kv-namespace.mjs';

class FakeKv {
  constructor() { this.values = new Map(); }
  async put(key, value, options) {
    this.values.set(key, { value, metadata: options?.metadata });
  }
  async getWithMetadata(key, options) {
    assert.deepEqual(options, { type: 'stream', cacheTtl: 300 });
    const stored = this.values.get(key);
    if (!stored) return { value: null, metadata: null };
    return {
      value: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(stored.value));
          controller.close();
        },
      }),
      metadata: stored.metadata,
    };
  }
}

class NoD1Db {
  prepare() { throw new Error('D1 response storage must not run on a KV hit'); }
}

class FakeEdgeCache {
  constructor() { this.response = null; this.puts = 0; }
  async match() { return this.response?.clone() || undefined; }
  async put(_key, response) {
    this.response = response;
    this.puts += 1;
  }
}

const historyRequest = () => new Request(
  'https://internal.test/_internal/pages-response?key=history%3Adaily',
);
const dashboardRequest = () => new Request(
  'https://internal.test/_internal/pages-response?key=dashboard',
);

test('materialized responses publish once to KV and are served as streams', async () => {
  const kv = new FakeKv();
  const now = Date.UTC(2026, 6, 20, 0, 35);
  const saved = await saveMaterializedResponse(
    new NoD1Db(),
    kv,
    'history:daily',
    Response.json({ ok: true, rows: [1, 2, 3] }),
    now,
    21_600,
  );
  assert.equal(saved.storage, 'kv');
  assert.ok(kv.values.has(pagesResponseKey('history:daily')));

  const response = await loadMaterializedResponse(kv, 'history:daily', now + 60_000, 21_900_000);
  assert.equal(response.headers.get('x-api-source'), 'worker-kv');
  assert.deepEqual(await response.json(), { ok: true, rows: [1, 2, 3] });
});

test('R2 absorbs a KV publication failure without touching D1', async () => {
  const puts = [];
  const now = Date.UTC(2026, 6, 20, 0, 35);
  const saved = await saveMaterializedResponse(
    new NoD1Db(),
    { async put() { throw new Error('KV temporarily unavailable'); } },
    'history:daily',
    Response.json({ ok: true }),
    now,
    21_600,
    { r2: { async put(...args) { puts.push(args); } } },
  );
  assert.equal(saved.storage, 'r2');
  assert.equal(puts.length, 1);
});

test('dual storage failure never falls back to D1 response tables', async () => {
  await assert.rejects(saveMaterializedResponse(
    new NoD1Db(),
    { async put() { throw new Error('KV unavailable'); } },
    'history:daily',
    Response.json({ ok: true }),
    Date.UTC(2026, 6, 20, 0, 35),
    21_600,
    {
      r2: { async put() { throw new Error('R2 unavailable'); } },
      async saveR2Response(r2) { return r2.put(); },
    },
  ), /could not be persisted to KV or R2/);
});

test('dashboard endpoint returns a KV response or a closed fallback signal', async () => {
  const now = Date.UTC(2026, 6, 20, 0, 35);
  const hit = await runPagesResponseFetch(
    dashboardRequest(),
    { PAGES_RESPONSE_KV: {} },
    {
      now: () => now,
      loadResponse: async () => Response.json({ source: 'kv' }),
    },
  );
  assert.equal(hit.status, 200);
  assert.deepEqual(await hit.json(), { source: 'kv' });

  const miss = await runPagesResponseFetch(
    dashboardRequest(),
    {},
    { loadResponse: async () => null, loadR2Response: async () => null },
  );
  assert.equal(miss.status, 404);
});

test('dashboard endpoint uses R2 when the KV model is absent', async () => {
  const calls = [];
  const response = await runPagesResponseFetch(
    dashboardRequest(),
    {},
    {
      loadResponse: async () => { calls.push('kv'); return null; },
      loadR2Response: async () => { calls.push('r2'); return Response.json({ source: 'r2' }); },
    },
  );
  assert.deepEqual(calls, ['kv', 'r2']);
  assert.deepEqual(await response.json(), { source: 'r2' });
});

test('completed history reads R2 without consulting KV', async () => {
  const calls = [];
  const response = await runPagesResponseFetch(
    historyRequest(),
    {},
    {
      loadResponse: async () => { calls.push('kv'); return Response.json({ source: 'kv' }); },
      loadR2Response: async () => { calls.push('r2'); return Response.json({ source: 'r2' }); },
    },
  );
  assert.deepEqual(calls, ['r2']);
  assert.deepEqual(await response.json(), { source: 'r2' });
});

test('track-history prefers R2 before the legacy KV fallback', async () => {
  const calls = [];
  const response = await runPagesResponseFetch(
    new Request('https://internal.test/_internal/pages-response?key=track-history'),
    {},
    {
      loadR2Response: async () => { calls.push('r2'); return Response.json({ source: 'r2' }); },
      loadResponse: async () => { calls.push('kv'); return null; },
    },
  );
  assert.deepEqual(calls, ['r2']);
  assert.deepEqual(await response.json(), { source: 'r2' });
});

test('dashboard endpoint uses Cache API as a same-colo L1 before KV', async () => {
  const cache = new FakeEdgeCache();
  const now = Date.UTC(2026, 6, 20, 0, 35);
  const first = await runPagesResponseFetch(dashboardRequest(), {}, {
    cache,
    now: () => now,
    loadResponse: async () => {
      const response = Response.json({ source: 'kv' });
      response.headers.set('x-materialized-at', String(now));
      return response;
    },
  });
  assert.equal(first.headers.get('x-api-source'), null);
  assert.equal(cache.puts, 1);

  let kvReads = 0;
  const second = await runPagesResponseFetch(dashboardRequest(), {}, {
    cache,
    now: () => now + 1_000,
    loadResponse: async () => {
      kvReads += 1;
      return null;
    },
  });
  assert.equal(second.headers.get('x-api-source'), 'edge-cache');
  assert.equal(kvReads, 0);
  assert.deepEqual(await second.json(), { source: 'kv' });
});

test('dashboard endpoint schedules Cache API writes on the real execution context', async () => {
  const cache = new FakeEdgeCache();
  const waits = [];
  const now = Date.UTC(2026, 6, 20, 0, 35);
  const response = await runPagesResponseFetch(
    dashboardRequest(),
    {},
    { waitUntil(promise) { waits.push(promise); } },
    {
      cache,
      now: () => now,
      loadResponse: async () => {
        const result = Response.json({ source: 'kv' });
        result.headers.set('x-materialized-at', String(now));
        return result;
      },
    },
  );
  assert.equal(response.status, 200);
  await Promise.all(waits);
  assert.equal(cache.puts, 1);
});

test('deployment resolves the exact namespace and replaces the placeholder id', () => {
  const title = 'sh-pages-read-model-pages-response-kv';
  assert.equal(namespaceIdFromList({ result: [
    { id: 'other', title: 'other' },
    { id: 'pages-id', title },
  ] }), 'pages-id');
  const rendered = JSON.parse(pagesReadModelConfigWithNamespaceId(JSON.stringify({
    kv_namespaces: [{ binding: 'PAGES_RESPONSE_KV', id: 'placeholder' }],
  }), 'pages-id'));
  assert.equal(rendered.kv_namespaces[0].id, 'pages-id');
});

test('deployment searches every namespace page before creating a new namespace', async () => {
  const title = 'sh-pages-read-model-pages-response-kv';
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method });
    const page = Number(new URL(url).searchParams.get('page'));
    if (page === 1) {
      return Response.json({
        success: true,
        result: Array.from({ length: 1000 }, (_, index) => ({ id: `other-${index}`, title: `other-${index}` })),
        result_info: { page: 1, per_page: 1000, total_count: 1001 },
      });
    }
    return Response.json({
      success: true,
      result: [{ id: 'pages-id', title }],
      result_info: { page: 2, per_page: 1000, total_count: 1001 },
    });
  };
  const namespace = await ensurePagesResponseNamespace({
    accountId: 'account',
    apiToken: 'token',
    fetch,
  });
  assert.deepEqual(namespace, { id: 'pages-id', title, created: false });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(({ method }) => method), ['GET', 'GET']);
  assert.match(requests[1].url, /page=2/);
});
