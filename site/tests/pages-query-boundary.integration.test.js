import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PAGES_QUERY_ROUTES } from '../../worker/src/pages-query-contract.js';
import { runPagesResponseFetch } from '../../worker/src/pages-response-fetch-entry.js';
import { PagesHistoryApiCoordinator } from '../../worker/src/pages-history-api-coordinator.js';
import { modelBucket } from './helpers/model-bucket.js';

for (const route of PAGES_QUERY_ROUTES) {
  test(`${route}: Pages forwards parameters and streams Worker response without database fallback`, async () => {
    const { onRequestGet } = await import(`../functions/api/${route}.js`);
    const body = JSON.stringify({ ok: true, rows: ['x'.repeat(700_000)] });
    const response = new Response(body);
    response.json = () => { throw new Error('Pages must not parse model JSON'); };
    let calls = 0;
    const db = { prepare() { throw new Error('Pages must not query D1'); } };
    const result = await onRequestGet({
      request: new Request(`https://public.test/api/${route}?from=2026-10-01&to=2026-10-14&channel_id=318&key=evil&api=evil&v=1`),
      env: { MINUTE_DB: db, OTHER_DB: db, PAGES_READ_MODEL_SERVICE: { async fetch(request) {
        calls++;
        const url = new URL(request.url);
        assert.equal(url.searchParams.get('key'), `query:${route}`);
        assert.equal(url.searchParams.get('from'), '2026-10-01');
        assert.equal(url.searchParams.get('to'), '2026-10-14');
        assert.equal(url.searchParams.get('channel_id'), '318');
        assert.equal(url.searchParams.has('api'), false);
        assert.equal(url.searchParams.has('v'), false);
        return response;
      } } },
    });
    assert.equal(result, response);
    assert.equal(await result.text(), body);
    assert.equal(calls, 1);
    const failed = await onRequestGet({ request: new Request(`https://public.test/api/${route}`), env: { MINUTE_DB: db, OTHER_DB: db } });
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get('cache-control'), 'no-store');
  });
}

test('monthly listener data travels through Pages and DO without adding another HTTP body cache', async () => {
  const { onRequestGet } = await import('../functions/api/spotify-monthly-listeners.js');
  let reads = 0;
  const env = { PAGES_RESPONSE_R2: modelBucket({ async fetch() {
    reads++;
    return Response.json({ ok: true, monthly_listener_rows: [{
      snapshot_date: '2026-10-14', artist_key: 'sakurazaka46', artist_name: '櫻坂46', monthly_listeners: 500000,
    }] });
  } }), OTHER_DB: { prepare() { throw new Error('monthly listeners must use R2'); } } };
  const doNames = [];
  const coordinator = new PagesHistoryApiCoordinator(null, env);
  env.PAGES_HISTORY_API_COORDINATOR = { idFromName(name) { doNames.push(name); return name; }, get() { return coordinator; } };
  const cache = new Map();
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  const serviceEnv = { PAGES_READ_MODEL_SERVICE: { fetch(request) { return runPagesResponseFetch(request, env, ctx, {
    responseCache: { async match(key) { return cache.get(key.url)?.clone(); }, async put(key, response) { cache.set(key.url, response); } },
  }); } } };
  for (let i = 0; i < 2; i++) {
    const result = await onRequestGet({ request: new Request('https://public.test/api/spotify-monthly-listeners'), env: serviceEnv });
    assert.equal(result.status, 200);
    const payload = await result.json();
    assert.equal(payload.ok, true);
    assert.ok(JSON.stringify(payload).includes('500000'));
    await Promise.all(pending);
  }
  assert.equal(reads, 2);
  assert.equal(cache.size, 0);
  assert.deepEqual(doNames, ['query:spotify-monthly-listeners', 'query:spotify-monthly-listeners']);
});

test('HTTP and Pages entrypoints cannot import the heavy query dispatcher or parse model JSON', () => {
  const http = readFileSync(new URL('../../worker/src/pages-response-fetch-entry.js', import.meta.url), 'utf8');
  assert.doesNotMatch(http, /pages-query-entry|pages-query-api-|await\s+\w+\.json\(/);
  for (const route of PAGES_QUERY_ROUTES) {
    const source = readFileSync(new URL(`../functions/api/${route}.js`, import.meta.url), 'utf8');
    assert.match(source, /proxyPagesQuery/);
    assert.doesNotMatch(source, /pages-query-api-|\.prepare\(|\.json\(|JSON\.parse|JSON\.stringify|\.filter\(|\.sort\(/);
  }
});

test('DO query errors cannot be cached and successful responses retain the previous public TTL cap', async () => {
  const env = { PAGES_RESPONSE_R2: modelBucket({ async fetch() { return Response.json({ ok: true, latest: { channel_id: 318 } }); } }) };
  const coordinator = new PagesHistoryApiCoordinator(null, env);
  const request = query => new Request(`https://internal/_internal/pages-response?key=query:dashboard-details&${query}`);
  const invalid = await coordinator.fetch(request('channel_id=invalid'));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('cache-control'), 'no-store');
  const valid = await coordinator.fetch(request('channel_id=318'));
  assert.equal(valid.status, 200);
  assert.match(valid.headers.get('cache-control'), /s-maxage=300/);
  const failed = await coordinator.fetch(new Request('https://internal/_internal/pages-response?key=query:host-history&mode=sessions'));
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get('cache-control'), 'no-store');
  assert.equal((await coordinator.fetch(new Request('https://internal/_internal/pages-response?key=query:unknown'))).status, 404);
});

test('regional compaction occurs inside the DO and keeps chart data while dropping unused payload', async () => {
  const chart = { tw: { daily: [{ date: '2026-10-15', rank: 1 }] } };
  const env = { PAGES_RESPONSE_R2: modelBucket({ async fetch(request) {
    assert.equal(new URL(request.url).searchParams.get('key'), 'music-service:kkbox');
    return Response.json({ ok: true, service: 'kkbox', kkbox_japanese_chart: chart,
      unused_bulk: 'x'.repeat(700_000) }, { headers: { etag: 'old-body' } });
  } }) };
  const coordinator = new PagesHistoryApiCoordinator(null, env);
  const result = await coordinator.fetch(new Request('https://internal/_internal/pages-response?key=query:kkbox'));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('etag'), null);
  const payload = await result.json();
  assert.deepEqual(payload.kkbox_japanese_chart, chart);
  assert.equal(payload.unused_bulk, undefined);
  assert.equal(result.headers.get('x-pages-payload'), 'compact');
});

test('official-series Worker cache never exceeds the existing five-minute Pages lifetime', async () => {
  const env = { OTHER_DB: { prepare() { return { bind() { return this; }, async all() { return { results: [] }; } }; } } };
  const coordinator = new PagesHistoryApiCoordinator(null, env);
  const response = await coordinator.fetch(new Request('https://internal/_internal/pages-response?key=query:sakurazaka46jp&from=2026-10-01&to=2026-10-14'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /s-maxage=300(?:,|$)/);
  assert.doesNotMatch(response.headers.get('cache-control'), /s-maxage=3600/);
});
