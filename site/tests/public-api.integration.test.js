import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cachedHistoryLoad,
  onRequestGet as historyGet,
  resetHistoryLoadCache,
} from '../functions/api/history.js';
import { onRequestGet as sakurazakaGet } from '../functions/api/sakurazaka46jp.js';
import { FakeD1Database, responseJson } from './helpers/fake-d1.js';

test('history endpoint rejects unknown modes and never caches errors', async () => {
  const response = await historyGet({
    request: new Request('https://skrzk.test/api/history?mode=unknown'),
    env: { DB: new FakeD1Database() },
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await responseJson(response), {
    ok: false,
    error: 'unsupported history mode: unknown',
  });
});

test('broadcast history reports setup-required only when no imported event exists', async () => {
  resetHistoryLoadCache();
  const db = new FakeD1Database().route('all', 'WITH eligible AS', {
    results: [{ event_name: null, has_data: 0 }],
  });
  const response = await historyGet({
    request: new Request('https://skrzk.test/api/history?mode=broadcasts&from=2026-01-01&to=2026-01-02'),
    env: { DB: new FakeD1Database(), OTHER_DB: db },
  });
  const body = await responseJson(response);
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'broadcasts');
  assert.equal(body.setup_required, true);
  assert.deepEqual(body.rows, []);
});

test('history endpoint restores the ranking leaderboard from the R2 read model', async () => {
  resetHistoryLoadCache();
  const model = {
    version: 1,
    refreshed_at: 1_790_000_000_000,
    source_max_ranking_date: '2026-07-14',
    ranking_weeks: ['2026-07-07', '2026-07-14'],
    actual_rows: [{
      ranking_date: '2026-07-07',
      observed_at: Date.parse('2026-07-07T00:00:00Z'),
      ranking_type: '週間リーダーボード',
      rank: 3,
      host_name: 'sakuramankai',
      host_alias: '櫻坂46',
      source_sheet: 'weekly',
      quality_score: 1,
      quality_flags: null,
    }],
    completed_rows: [
      {
        ranking_date: '2026-07-07',
        observed_at: Date.parse('2026-07-07T00:00:00Z'),
        ranking_type: '週間リーダーボード',
        rank: 3,
        host_name: 'sakuramankai',
        host_alias: '櫻坂46',
      },
      {
        ranking_date: '2026-07-14',
        observed_at: Date.parse('2026-07-14T00:00:00Z'),
        ranking_type: '週間リーダーボード',
        rank: null,
        host_name: 'sakuramankai',
        host_alias: 'sakuramankai',
        synthetic: true,
        is_out_of_rank: true,
      },
    ],
    weekly_metrics: [],
  };
  const requests = [];
  const response = await historyGet({
    request: new Request('https://skrzk.test/api/history?mode=ranking&from=2026-07-01&to=2026-07-31'),
    env: {
      PAGES_READ_MODEL_SERVICE: {
        async fetch(request) {
          const url = new URL(request.url);
          requests.push(url);
          return Response.json(model, {
            headers: { 'x-materialized-at': String(model.refreshed_at) },
          });
        },
      },
    },
  });
  const body = await responseJson(response);
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'ranking');
  assert.deepEqual(body.ranking_weeks, ['2026-07-07', '2026-07-14']);
  assert.equal(body.rows[0].ranking_date, '2026-07-14');
  assert.equal(body.rows[0].rank, null);
  assert.equal(body.rows[0].is_out_of_rank, true);
  assert.equal(body.rows.find((row) => row.ranking_date === '2026-07-07' && row.host_name === 'sakuramankai').rank, 3);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('key'), 'leaderboard');
  assert.equal(body.read_path, 'leaderboard-r2-read-model');
});

test('history rejects impossible dates before querying D1', async () => {
  const env = {
    DB: { prepare() { throw new Error('D1 should not be queried'); } },
    OTHER_DB: { prepare() { throw new Error('D1 should not be queried'); } },
  };
  const response = await historyGet({
    request: new Request('https://skrzk.test/api/history?mode=broadcasts&from=2026-02-30&to=2026-03-01'),
    env,
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await responseJson(response), {
    ok: false,
    error: 'from and to must be valid YYYY-MM-DD dates',
  });
});

test('Sakurazaka series rejects impossible dates before querying D1', async () => {
  const env = {
    OTHER_DB: { prepare() { throw new Error('D1 should not be queried'); } },
  };
  const response = await sakurazakaGet({
    request: new Request('https://skrzk.test/api/sakurazaka46jp?from=2026-02-30&to=2026-03-01'),
    env,
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await responseJson(response), {
    ok: false,
    error: 'from and to must be valid YYYY-MM-DD dates',
  });
});

test('history cache coalesces concurrent readers and can be reset safely', async () => {
  resetHistoryLoadCache();
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loader = async () => {
    loads += 1;
    await gate;
    return { value: 42 };
  };
  const first = cachedHistoryLoad('integration:key', 60_000, loader, 100);
  const second = cachedHistoryLoad('integration:key', 60_000, loader, 100);
  release();
  assert.deepEqual(await first, { value: 42 });
  assert.deepEqual(await second, { value: 42 });
  assert.equal(loads, 1);
  resetHistoryLoadCache();
});
