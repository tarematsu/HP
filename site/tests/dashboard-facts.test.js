import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestGet as dashboardGet } from '../functions/api/dashboard.js';
import { onRequestGet as dashboardDetailsGet } from '../functions/api/dashboard-details.js';
import {
  FACTS_HISTORY_24H_SQL,
  FACTS_HISTORY_SINCE_SQL,
  FACTS_LATEST_SQL,
  FACTS_PREDICTION_24H_SQL,
  factsAreFresh,
  loadFactsDashboard,
  mergeFactsLatest,
} from '../functions/lib/dashboard-facts.js';
import { FakeD1Database, responseJson } from './helpers/fake-d1.js';

test('facts dashboard SQL preserves the unified dashboard response contract', () => {
  assert.match(FACTS_LATEST_SQL, /FROM sh_minute_facts AS f/);
  assert.match(FACTS_LATEST_SQL, /INDEXED BY idx_sh_minute_facts_live_minute/);
  assert.doesNotMatch(FACTS_LATEST_SQL, /comment_velocity|comment_count|recent INDEXED BY/);
  assert.match(FACTS_LATEST_SQL, /reported_total_listens AS total_listens/);
  assert.match(FACTS_LATEST_SQL, /reported_current_stream_count AS current_stream_count/);
  assert.doesNotMatch(FACTS_LATEST_SQL, /previous\./);
  assert.match(FACTS_LATEST_SQL, /LEFT JOIN sh_minute_fact_context_v2/);
  assert.doesNotMatch(FACTS_LATEST_SQL, /LEFT JOIN sh_minute_fact_context AS/);
  assert.match(FACTS_LATEST_SQL, /WHERE f\.source_code=1/);
  assert.match(FACTS_HISTORY_24H_SQL, /FROM sh_dashboard_history_5m r/);
  assert.match(FACTS_HISTORY_24H_SQL, /r\.channel_id=\?1/);
  assert.match(FACTS_HISTORY_24H_SQL, /r\.bucket_at>=unixepoch\('now','-24 hours'\)\*1000/);
  assert.match(FACTS_HISTORY_24H_SQL, /ORDER BY r\.bucket_at ASC/);
  assert.doesNotMatch(FACTS_HISTORY_24H_SQL, /sh_total_member_daily|MATERIALIZED|ROW_NUMBER\(\) OVER/);
  assert.match(FACTS_HISTORY_SINCE_SQL, /FROM sh_dashboard_history_5m r/);
  assert.match(FACTS_HISTORY_SINCE_SQL, /r\.bucket_at>=\?2-300000/);
  assert.match(FACTS_HISTORY_SINCE_SQL, /r\.observed_at>\?2/);
  assert.match(FACTS_PREDICTION_24H_SQL, /FROM sh_dashboard_history_5m r/);
  assert.match(FACTS_PREDICTION_24H_SQL, /r\.current_stream_count/);
  assert.doesNotMatch(FACTS_PREDICTION_24H_SQL, /reported_current_stream_count/);
  assert.doesNotMatch(FACTS_HISTORY_24H_SQL, /sh_channel_snapshots/);
});

test('facts freshness rejects missing and delayed telemetry', () => {
  assert.equal(factsAreFresh({ observed_at: 940_000 }, 1_000_000), true);
  assert.equal(factsAreFresh({ observed_at: 399_999 }, 1_000_000), false);
  assert.equal(factsAreFresh(null, 1_000_000), false);
});

test('facts telemetry overrides collector metrics while retaining presentation fields', () => {
  const merged = mergeFactsLatest({
    observed_at: 10,
    channel_name: 'Buddies',
    raw_json: '{"description":"kept"}',
    stream_goal: 50_000_000,
    online_member_count: 1,
  }, {
    observed_at: 20,
    online_member_count: 167,
    current_stream_count: 49_127_261,
  });
  assert.equal(merged.channel_name, 'Buddies');
  assert.equal(merged.raw_json, '{"description":"kept"}');
  assert.equal(merged.stream_goal, 50_000_000);
  assert.equal(merged.observed_at, 20);
  assert.equal(merged.online_member_count, 167);
});

test('persisted prediction state suppresses the per-request aggregate scan', async () => {
  const db = new FakeD1Database()
    .route('first', 'FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_live_minute', {
      id: 1,
      observed_at: Date.now(),
      channel_id: 318,
    });

  await loadFactsDashboard(db, {
    since: 1,
    includeHistory: false,
    includePrediction: false,
  });

  assert.equal(db.callsMatching(/FROM sh_dashboard_history_5m r/).length, 0);
  assert.equal(db.callsMatching(/reported_current_stream_count AS current_stream_count/).length, 1);
});

test('dashboard and dashboard-details serve the same materialized Worker model without D1 reads', async () => {
  const payload = {
    ok: true,
    generated_at: Date.now(),
    metrics_source: 'minute-facts',
    storage_source: 'minute-facts',
    latest_observed_at: Date.now() - 2_000,
    latest: {
      channel_id: 318,
      channel_name: 'Buddies',
      online_member_count: 167,
      current_stream_count: 49_127_261,
      stream_goal: 50_000_000,
    },
    history: [
      { observed_at: Date.now() - 302_000, online_member_count: 160, current_stream_count: 49_127_250 },
      { observed_at: Date.now() - 2_000, online_member_count: 167, current_stream_count: 49_127_261 },
    ],
    previous_day_history: [{ observed_at: Date.now() - 86_400_000, online_member_count: 140 }],
    stream_5m_history: [{ observed_at: Date.now() - 2_000, stream_delta: 11 }],
    daily_change: { total_member_count: 99, total_listens: 366 },
    daily_summaries: { yesterday: { member_growth: 11, stream_growth: 55 } },
    queue: [],
    queue_status: null,
    queue_revision: '',
  };
  let reads = 0;
  const service = {
    async fetch(request) {
      reads += 1;
      const requested = new URL(request.url);
      assert.equal(requested.pathname, '/_internal/pages-response');
      assert.equal(requested.searchParams.get('key'), 'dashboard');
      return Response.json(payload);
    },
  };

  const response = await dashboardGet({
    request: new Request('https://skrzk.test/api/dashboard'),
    env: {
      PAGES_READ_MODEL_SERVICE: service,
      MINUTE_DB: { prepare() { throw new Error('dashboard must not read MINUTE_DB'); } },
      OTHER_DB: { prepare() { throw new Error('dashboard must not read OTHER_DB'); } },
    },
  });
  const body = await responseJson(response);
  assert.equal(response.status, 200);
  assert.equal(body.latest.channel_name, 'Buddies');
  assert.equal(body.latest.online_member_count, 167);
  assert.equal(body.daily_summaries.yesterday.stream_growth, 55);

  const detailsResponse = await dashboardDetailsGet({
    request: new Request('https://skrzk.test/api/dashboard-details?channel_id=318'),
    env: {
      PAGES_READ_MODEL_SERVICE: service,
      MINUTE_DB: { prepare() { throw new Error('dashboard details must not read MINUTE_DB'); } },
      OTHER_DB: { prepare() { throw new Error('dashboard details must not read OTHER_DB'); } },
    },
  });
  const details = await responseJson(detailsResponse);
  assert.equal(detailsResponse.status, 200);
  assert.equal(details.channel_id, 318);
  assert.equal(details.history.at(-1).online_member_count, 167);
  assert.equal(details.stream_5m_history.at(-1).stream_delta, 11);
  assert.equal(details.daily_summaries.yesterday.member_growth, 11);
  assert.equal(reads, 2);
});
