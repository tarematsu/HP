import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchHistoryPayload,
  migrateHistoryCache,
} from '../public/history/history-data-client.js';

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

test('history summary requests preserve from/to for edge-side materialized filtering', async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url);
    assert.equal(url.pathname, '/api/history');
    assert.equal(url.search, '?mode=weekly&from=2026-06-01&to=2026-06-30');
    return Response.json({
      ok: true,
      mode: 'weekly',
      from: '2026-06-01',
      to: '2026-06-30',
      timezone: 'UTC',
      read_path: 'r2-materialized-range',
      rows: [
        { period_key: '2026-06-01', sample_count: 510 },
        { period_key: '2026-06-29', sample_count: 520 },
      ],
    });
  };

  const data = await fetchHistoryPayload(
    'https://skrzk.test/api/history?mode=weekly&from=2026-06-01&to=2026-06-30',
    { fetchImpl },
  );
  assert.equal(calls.length, 1);
  assert.equal(data.read_path, 'r2-materialized-range');
  assert.equal(data.from, '2026-06-01');
  assert.equal(data.to, '2026-06-30');
  assert.deepEqual(data.rows.map((row) => row.period_key), ['2026-06-01', '2026-06-29']);

  const storage = new MemoryStorage([
    ['sh.history.v3:/api/history?mode=weekly&from=old&to=old', '{"stale":true}'],
  ]);
  migrateHistoryCache(storage);
  assert.equal(storage.getItem('sh.history.direct-fetch.v1'), '1');
  assert.equal(storage.getItem('sh.history.v3:/api/history?mode=weekly&from=old&to=old'), null);
});

test('history error responses preserve the requested range and do not retry dynamically', async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url.href);
    return Response.json({ ok: false, error: 'materialized unavailable' }, { status: 503 });
  };

  await assert.rejects(
    fetchHistoryPayload(
      'https://skrzk.test/api/history?mode=weekly&from=2026-06-01&to=2026-06-30',
      { fetchImpl },
    ),
    /materialized unavailable/,
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/history\?mode=weekly&from=2026-06-01&to=2026-06-30$/);
});

test('network failures propagate without a second history request', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('network unavailable');
  };

  await assert.rejects(
    fetchHistoryPayload(
      'https://skrzk.test/api/history?mode=monthly&from=2026-01-01&to=2026-07-30',
      { fetchImpl },
    ),
    /network unavailable/,
  );
  assert.equal(calls, 1);
});
