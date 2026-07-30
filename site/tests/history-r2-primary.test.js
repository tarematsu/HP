import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

async function withGuard(fetchImpl, callback, suffix, entries = []) {
  const previousWindow = globalThis.window;
  const storage = new MemoryStorage(entries);
  const browser = {
    location: new URL('https://skrzk.test/history/#weekly'),
    fetch: fetchImpl,
    sessionStorage: storage,
    document: { getElementById() { return null; } },
    addEventListener() {},
    dispatchEvent() {},
    requestAnimationFrame() { return 1; },
  };
  globalThis.window = browser;
  try {
    await import(`../public/history/history-request-guard.js?test=${suffix}`);
    await callback(browser, storage);
  } finally {
    globalThis.window = previousWindow;
  }
}

test('history summary requests use the mode-only R2 materialization and filter the requested range locally', async () => {
  const calls = [];
  await withGuard(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url);
    assert.equal(url.pathname, '/api/history');
    assert.equal(url.search, '?mode=weekly');
    return Response.json({
      ok: true,
      mode: 'weekly',
      timezone: 'UTC',
      rows: [
        { period_key: '2026-05-25', sample_count: 500 },
        { period_key: '2026-06-01', sample_count: 510 },
        { period_key: '2026-06-29', sample_count: 520 },
        { period_key: '2026-07-06', sample_count: 530 },
      ],
    }, { headers: { 'x-api-source': 'actions-r2' } });
  }, async (browser, storage) => {
    const response = await browser.fetch('/api/history?mode=weekly&from=2026-06-01&to=2026-06-30');
    const data = await response.json();
    assert.equal(calls.length, 1);
    assert.equal(response.headers.get('x-api-source'), 'actions-r2');
    assert.equal(response.headers.get('x-history-read-path'), 'r2-materialized');
    assert.equal(data.read_path, 'r2-materialized');
    assert.equal(data.from, '2026-06-01');
    assert.equal(data.to, '2026-06-30');
    assert.deepEqual(data.rows.map((row) => row.period_key), ['2026-06-01', '2026-06-29']);
    assert.equal(storage.getItem('sh.history.r2-primary.v1'), '1');
    assert.equal(storage.getItem('sh.history.v3:/api/history?mode=weekly&from=old&to=old'), null);
  }, 'materialized', [
    ['sh.history.v3:/api/history?mode=weekly&from=old&to=old', '{"stale":true}'],
  ]);
});

test('history summaries never fall back to the dynamic OTHER_DB or MINUTE_DB API', async () => {
  const calls = [];
  await withGuard(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url.href);
    return Response.json({ ok: false, error: 'materialized unavailable' }, { status: 503 });
  }, async (browser) => {
    const response = await browser.fetch('/api/history?mode=weekly&from=2026-06-01&to=2026-06-30');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-history-read-path'), 'r2-materialized-unavailable');
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'materialized unavailable',
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/api\/history\?mode=weekly$/);
    assert.doesNotMatch(calls[0], /from=/);
    assert.doesNotMatch(calls[0], /to=/);
  }, 'strict-r2');
});

test('network failure returns an R2-unavailable response instead of dynamic history', async () => {
  let calls = 0;
  await withGuard(async () => {
    calls += 1;
    throw new Error('network unavailable');
  }, async (browser) => {
    const response = await browser.fetch('/api/history?mode=monthly&from=2026-01-01&to=2026-07-30');
    const data = await response.json();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-history-read-path'), 'r2-materialized-unavailable');
    assert.equal(data.ok, false);
    assert.equal(data.error, 'materialized history unavailable');
    assert.match(data.detail, /network unavailable/);
    assert.equal(calls, 1);
  }, 'network-r2-only');
});
