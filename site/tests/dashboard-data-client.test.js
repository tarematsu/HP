import assert from 'node:assert/strict';
import test from 'node:test';

const moduleUrl = new URL('../public/dashboard-data-client.js', import.meta.url);
async function client() { return import(`${moduleUrl}?test=${Math.random()}`); }
const response = (payload, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => payload });

test('concurrent consumers and later reads share one successful snapshot', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ ok: true, rows: [1] }); };
  try {
    const { loadDashboardJson } = await client();
    const [a, b] = await Promise.all([loadDashboardJson('/shared'), loadDashboardJson('/shared')]);
    assert.strictEqual(a, b);
    assert.strictEqual(await loadDashboardJson('/shared'), a);
    assert.equal(calls, 1);
    await loadDashboardJson('/shared', { force: true });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('a failed read is evicted and can be retried', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => response(++calls === 1 ? { error: 'temporary' } : { ok: true }, calls > 1);
  try {
    const { loadDashboardJson } = await client();
    await assert.rejects(loadDashboardJson('/retry'), /temporary/);
    assert.equal((await loadDashboardJson('/retry')).ok, true);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('cancelling one consumer preserves another consumer and the shared snapshot', async () => {
  const original = globalThis.fetch;
  let finish;
  let calls = 0;
  globalThis.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  try {
    const { loadDashboardJson } = await client();
    const controller = new AbortController();
    const cancelled = loadDashboardJson('/cancel', { signal: controller.signal });
    const surviving = loadDashboardJson('/cancel');
    controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    finish(response({ ok: true }));
    assert.equal((await surviving).ok, true);
    assert.equal((await loadDashboardJson('/cancel')).ok, true);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('settled snapshots expire without duplicating pending reads', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 100;
  let calls = 0;
  let finish;
  Date.now = () => now;
  globalThis.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  try {
    const { loadDashboardJson } = await client();
    const a = loadDashboardJson('/freshness');
    now += 120_000;
    const b = loadDashboardJson('/freshness');
    assert.equal(calls, 1);
    finish(response({ ok: true, revision: 1 }));
    await Promise.all([a, b]);
    now += 59_999;
    assert.equal((await loadDashboardJson('/freshness')).revision, 1);
    now++;
    const refreshed = loadDashboardJson('/freshness');
    assert.equal(calls, 2);
    finish(response({ ok: true, revision: 2 }));
    assert.equal((await refreshed).revision, 2);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});
