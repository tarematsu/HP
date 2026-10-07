import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet as dashboardGet } from '../functions/api/dashboard.js';
import { onRequestGet as dashboardDetailsGet } from '../functions/api/dashboard-details.js';
import { responseJson } from './helpers/fake-d1.js';

function dashboardPayload() {
  const now = Date.now();
  return {
    ok: true,
    generated_at: now,
    metrics_source: 'minute-facts',
    storage_source: 'minute-facts',
    latest_observed_at: now - 2_000,
    latest: {
      channel_id: 318,
      channel_name: 'Buddies',
      online_member_count: 167,
      current_stream_count: 49_127_261,
      stream_goal: 50_000_000,
    },
    history: [
      { observed_at: now - 302_000, online_member_count: 160, current_stream_count: 49_127_250 },
      { observed_at: now - 2_000, online_member_count: 167, current_stream_count: 49_127_261 },
    ],
    previous_day_history: [{ observed_at: now - 86_400_000, online_member_count: 140 }],
    stream_5m_history: [{ observed_at: now - 2_000, stream_delta: 11 }],
    daily_change: { total_member_count: 99, total_listens: 366 },
    daily_summaries: { yesterday: { member_growth: 11, stream_growth: 55 } },
    queue: [],
    queue_status: null,
    queue_revision: '',
  };
}

function readModelService(payload, reads) {
  return {
    async fetch(request) {
      reads.push(new URL(request.url));
      return Response.json(payload);
    },
  };
}

test('dashboard serves the Worker materialized model without Pages D1 reads', async () => {
  const payload = dashboardPayload();
  const reads = [];
  const response = await dashboardGet({
    request: new Request('https://skrzk.test/api/dashboard'),
    env: {
      PAGES_READ_MODEL_SERVICE: readModelService(payload, reads),
      MINUTE_DB: { prepare() { throw new Error('dashboard must not read MINUTE_DB'); } },
      OTHER_DB: { prepare() { throw new Error('dashboard must not read OTHER_DB'); } },
    },
  });
  const body = await responseJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body, payload);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].pathname, '/_internal/pages-response');
  assert.equal(reads[0].searchParams.get('key'), 'dashboard');
});

test('dashboard-details reuses the same materialized model and returns only detail fields', async () => {
  const payload = dashboardPayload();
  const reads = [];
  const response = await dashboardDetailsGet({
    request: new Request('https://skrzk.test/api/dashboard-details?channel_id=318'),
    env: {
      PAGES_READ_MODEL_SERVICE: readModelService(payload, reads),
      MINUTE_DB: { prepare() { throw new Error('dashboard details must not read MINUTE_DB'); } },
      OTHER_DB: { prepare() { throw new Error('dashboard details must not read OTHER_DB'); } },
    },
  });
  const details = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(details.channel_id, 318);
  assert.equal(details.history.at(-1).online_member_count, 167);
  assert.equal(details.stream_5m_history.at(-1).stream_delta, 11);
  assert.equal(details.daily_summaries.yesterday.member_growth, 11);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].searchParams.get('key'), 'dashboard');
});

test('dashboard-details rejects a different channel without touching D1', async () => {
  const payload = dashboardPayload();
  const response = await dashboardDetailsGet({
    request: new Request('https://skrzk.test/api/dashboard-details?channel_id=999'),
    env: { PAGES_READ_MODEL_SERVICE: readModelService(payload, []) },
  });
  assert.equal(response.status, 404);
});
