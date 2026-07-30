import assert from 'node:assert/strict';
import test from 'node:test';

const NOW = Date.UTC(2026, 6, 30, 1, 30, 0);

async function withOverlay(fetchImpl, callback, suffix, entries = []) {
  const previousWindow = globalThis.window;
  const previousNow = Date.now;

  class MemoryStorage {
    constructor(values = []) { this.values = new Map(values); }
    get length() { return this.values.size; }
    key(index) { return [...this.values.keys()][index] ?? null; }
    getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
  }

  const storage = new MemoryStorage(entries);
  const browser = {
    location: new URL('https://skrzk.test/history/#weekly'),
    fetch: fetchImpl,
    sessionStorage: storage,
  };
  globalThis.window = browser;
  Date.now = () => NOW;
  try {
    await import(`../public/history/history-current-overlay.js?test=${suffix}`);
    await callback(browser, storage);
  } finally {
    globalThis.window = previousWindow;
    Date.now = previousNow;
  }
}

function urlOf(input) {
  return new URL(typeof input === 'string' ? input : input.url);
}

test('current weekly row is replaced with the complete MINUTE_DB period while past R2 rows stay unchanged', async () => {
  const calls = [];
  await withOverlay(async (input) => {
    const url = urlOf(input);
    calls.push(url);
    if (url.pathname === '/api/history-current') {
      assert.equal(url.search, '?mode=weekly');
      return Response.json({
        ok: true,
        mode: 'weekly',
        rows: [{
          period_key: '2026-07-27',
          sample_count: 4321,
          reliable_sample_count: 4321,
          listener_avg: 121.5,
          likes_max: null,
          distinct_tracks: null,
          primary_host: null,
          period_end: NOW - 10_000,
        }],
      });
    }
    return Response.json({
      ok: true,
      mode: 'weekly',
      read_path: 'r2-materialized',
      rows: [
        { period_key: '2026-07-20', sample_count: 9999, likes_max: 55 },
        { period_key: '2026-07-27', sample_count: 51, likes_max: 77, distinct_tracks: 12, primary_host: 'stored-host' },
      ],
    }, { headers: { 'x-api-source': 'actions-r2' } });
  }, async (browser) => {
    const response = await browser.fetch('/api/history?mode=weekly&from=2026-07-01&to=2026-07-30');
    const data = await response.json();

    assert.equal(calls.length, 2);
    assert.equal(calls[0].pathname, '/api/history');
    assert.equal(calls[1].pathname, '/api/history-current');
    assert.equal(response.headers.get('x-api-source'), 'actions-r2');
    assert.equal(response.headers.get('x-history-live-overlay'), 'minute-current');
    assert.equal(data.read_path, 'r2-materialized+minute-current');
    assert.equal(data.live_source, 'minute_facts');
    assert.equal(data.live_overlay_count, 1);
    assert.deepEqual(data.rows.map((row) => [row.period_key, row.sample_count]), [
      ['2026-07-20', 9999],
      ['2026-07-27', 4321],
    ]);
    const current = data.rows.at(-1);
    assert.equal(current.likes_max, 77);
    assert.equal(current.distinct_tracks, 12);
    assert.equal(current.primary_host, 'stored-host');
    assert.equal(current.live_overlay, true);
  }, 'replace');
});

test('a historical range does not query MINUTE_DB', async () => {
  const calls = [];
  await withOverlay(async (input) => {
    calls.push(urlOf(input));
    return Response.json({
      ok: true,
      mode: 'weekly',
      rows: [{ period_key: '2026-07-13', sample_count: 1000 }],
    });
  }, async (browser) => {
    const response = await browser.fetch('/api/history?mode=weekly&from=2026-07-01&to=2026-07-20');
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, '/api/history');
  }, 'historical');
});

test('R2 remains usable when the current MINUTE_DB overlay is unavailable', async () => {
  await withOverlay(async (input) => {
    const url = urlOf(input);
    if (url.pathname === '/api/history-current') {
      return Response.json({ ok: false, error: 'minute unavailable' }, { status: 503 });
    }
    return Response.json({
      ok: true,
      mode: 'daily',
      read_path: 'r2-materialized',
      rows: [{ period_key: '2026-07-30', sample_count: 51 }],
    });
  }, async (browser) => {
    const response = await browser.fetch('/api/history?mode=daily&from=2026-07-30&to=2026-07-30');
    const data = await response.json();
    assert.equal(data.read_path, 'r2-materialized');
    assert.equal(data.rows[0].sample_count, 51);
    assert.equal(response.headers.get('x-history-live-overlay'), null);
  }, 'unavailable');
});

test('history session responses older than 30 seconds are ignored', async () => {
  const key = 'sh.history.v3:/api/history?mode=daily&from=2026-07-30&to=2026-07-30';
  await withOverlay(async () => Response.json({ ok: true, rows: [] }), async (_browser, storage) => {
    assert.equal(storage.getItem(key), null);
  }, 'cache', [[key, JSON.stringify({ at: NOW - 30_001, data: { ok: true } })]]);
});
