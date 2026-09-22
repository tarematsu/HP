import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DAILY_HISTORY_CACHE_TTL_MS,
  fetchHistoryPayload,
  historyCacheTtl,
  migrateHistoryCache,
} from '../public/history/history-data-client.js';

const NOW = Date.UTC(2026, 6, 30, 1, 30, 0);
const MIGRATION_KEY = 'sh.history.direct-fetch.v1';

class MemoryStorage {
  constructor(values = []) { this.values = new Map(values); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

function urlOf(input) {
  return new URL(typeof input === 'string' ? input : input.url, 'https://skrzk.test/');
}

test('only today daily row is replaced from MINUTE_DB while older R2 rows stay unchanged', async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = urlOf(input);
    calls.push(url);
    if (url.pathname === '/api/history-current') {
      assert.equal(url.search, '?mode=daily');
      return Response.json({
        ok: true,
        mode: 'daily',
        rows: [{
          period_key: '2026-07-30',
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
      mode: 'daily',
      read_path: 'r2-materialized',
      rows: [
        { period_key: '2026-07-29', sample_count: 1440, likes_max: 55 },
        { period_key: '2026-07-30', sample_count: 51, likes_max: 77, distinct_tracks: 12, primary_host: 'stored-host' },
      ],
    });
  };

  const data = await fetchHistoryPayload(
    'https://skrzk.test/api/history?mode=daily&from=2026-07-01&to=2026-07-30',
    { fetchImpl, now: NOW },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].pathname, '/api/history');
  assert.equal(calls[1].pathname, '/api/history-current');
  assert.equal(data.read_path, 'r2-materialized+minute-current-daily');
  assert.equal(data.live_source, 'minute_facts');
  assert.equal(data.live_overlay_count, 1);
  assert.deepEqual(data.rows.map((row) => [row.period_key, row.sample_count]), [
    ['2026-07-29', 1440],
    ['2026-07-30', 4321],
  ]);
  const current = data.rows.at(-1);
  assert.equal(current.likes_max, 77);
  assert.equal(current.distinct_tracks, 12);
  assert.equal(current.primary_host, 'stored-host');
  assert.equal(current.live_overlay, true);
});

for (const mode of ['weekly', 'monthly']) {
  test(`${mode} remains entirely on the R2 response, including the current period`, async () => {
    const calls = [];
    const fetchImpl = async (input) => {
      calls.push(urlOf(input));
      return Response.json({
        ok: true,
        mode,
        read_path: 'r2-materialized',
        rows: [{ period_key: mode === 'weekly' ? '2026-07-27' : '2026-07', sample_count: 51 }],
      });
    };
    const data = await fetchHistoryPayload(
      `https://skrzk.test/api/history?mode=${mode}&from=2026-07-01&to=2026-07-30`,
      { fetchImpl, now: NOW },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, '/api/history');
    assert.equal(data.read_path, 'r2-materialized');
  });
}

test('a historical daily range does not query MINUTE_DB', async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(urlOf(input));
    return Response.json({
      ok: true,
      mode: 'daily',
      read_path: 'r2-materialized',
      rows: [{ period_key: '2026-07-20', sample_count: 1000 }],
    });
  };
  const data = await fetchHistoryPayload(
    'https://skrzk.test/api/history?mode=daily&from=2026-07-01&to=2026-07-29',
    { fetchImpl, now: NOW },
  );
  assert.equal(data.rows[0].sample_count, 1000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, '/api/history');
});

test('R2 daily data remains usable when today MINUTE_DB overlay is unavailable', async () => {
  const fetchImpl = async (input) => {
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
  };
  const data = await fetchHistoryPayload(
    'https://skrzk.test/api/history?mode=daily&from=2026-07-30&to=2026-07-30',
    { fetchImpl, now: NOW },
  );
  assert.equal(data.read_path, 'r2-materialized');
  assert.equal(data.rows[0].sample_count, 51);
  assert.equal(data.live_source, undefined);
});

test('migration clears legacy history responses once without patching Storage', () => {
  const weeklyKey = 'sh.history.v3:/api/history?mode=weekly&from=old&to=old';
  const storage = new MemoryStorage([[weeklyKey, '{"stale":true}']]);
  migrateHistoryCache(storage);
  assert.equal(storage.getItem(weeklyKey), null);
  assert.equal(storage.getItem(MIGRATION_KEY), '1');

  storage.setItem(weeklyKey, '{"fresh":true}');
  migrateHistoryCache(storage);
  assert.equal(storage.getItem(weeklyKey), '{"fresh":true}');
});

test('daily session freshness is 30 seconds without a Storage prototype hook', () => {
  assert.equal(DAILY_HISTORY_CACHE_TTL_MS, 30_000);
  assert.equal(historyCacheTtl('daily'), 30_000);
  assert.equal(historyCacheTtl('weekly'), 5 * 60_000);
  assert.equal(historyCacheTtl('monthly'), 5 * 60_000);
  assert.equal(historyCacheTtl('broadcasts'), 15 * 60_000);
});
