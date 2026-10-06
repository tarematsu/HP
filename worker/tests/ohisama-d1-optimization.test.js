import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OHISAMA_AUTH_HOT_STATE_KEY,
  runOptimizedOhisamaCollectorScheduled,
} from '../src/ohisama-collector-optimized.js';
import {
  refreshOptimizedOhisamaReadModel,
  rollupOhisamaWeekly,
} from '../src/ohisama-read-model-optimized.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

const HINATA_KEY = pagesR2ResponseKey('hinata');

class FakeR2 {
  constructor(initial = new Map()) {
    this.values = initial;
    this.gets = 0;
    this.puts = 0;
  }

  async get(key) {
    this.gets += 1;
    const raw = this.values.get(key);
    if (raw == null) return null;
    return {
      body: true,
      async json() { return JSON.parse(raw); },
      async text() { return raw; },
    };
  }

  async put(key, value) {
    this.puts += 1;
    this.values.set(key, String(value));
  }
}

function pageEnvelope(payload, updatedAt) {
  return JSON.stringify({
    version: 1,
    updated_at: updatedAt,
    cadence_seconds: 300,
    status: 200,
    headers: {},
    body: JSON.stringify(payload),
  });
}

test('Ohisama weekly rollup uses Monday UTC boundaries and Buddies-style weighted aggregates', () => {
  const updatedAt = Date.parse('2026-10-04T23:55:00Z');
  const rows = [
    {
      period_key: '2026-09-28',
      period_start: Date.parse('2026-09-28T00:00:00Z'),
      period_end: Date.parse('2026-09-29T00:00:00Z'),
      sample_count: 100,
      listener_avg: 80,
      listener_min: 50,
      listener_max: 110,
      stream_start: 1000,
      stream_end: 1400,
      member_start: 2000,
      member_end: 2002,
    },
    {
      period_key: '2026-09-29',
      period_start: Date.parse('2026-09-29T00:00:00Z'),
      period_end: Date.parse('2026-09-30T00:00:00Z'),
      sample_count: 300,
      listener_avg: 120,
      listener_min: 70,
      listener_max: 150,
      stream_start: 1400,
      stream_end: 2000,
      member_start: 2002,
      member_end: 2008,
    },
  ];

  const weekly = rollupOhisamaWeekly(rows, updatedAt);
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].period_key, '2026-09-28');
  assert.equal(weekly[0].sample_count, 400);
  assert.equal(weekly[0].listener_avg, 110);
  assert.equal(weekly[0].listener_min, 50);
  assert.equal(weekly[0].listener_max, 150);
  assert.equal(weekly[0].stream_start, 1000);
  assert.equal(weekly[0].stream_end, 2000);
  assert.equal(weekly[0].stream_growth, 1000);
  assert.equal(weekly[0].member_start, 2000);
  assert.equal(weekly[0].member_end, 2008);
  assert.equal(weekly[0].member_growth, 8);
});

test('Ohisama same-day read-model refresh stays entirely off D1', async () => {
  const observedAt = Date.parse('2026-09-30T12:05:00Z');
  const previousAt = observedAt - 300_000;
  const r2 = new FakeR2(new Map([[
    HINATA_KEY,
    pageEnvelope({
      ok: true,
      model: 'hinata',
      updated_at: previousAt,
      latest: { observed_at: previousAt },
      history_24h: [{ observed_at: previousAt, online_member_count: 100, stream_count: 5000 }],
      daily: [{
        period_key: '2026-09-30',
        period_start: Date.parse('2026-09-30T00:00:00Z'),
        period_end: Date.parse('2026-10-01T00:00:00Z'),
        sample_count: 10,
        listener_avg: 100,
        listener_min: 90,
        listener_max: 110,
        stream_start: 4900,
        stream_end: 5000,
        stream_growth: 100,
        member_start: 2000,
        member_end: 2000,
        member_growth: 0,
      }],
      weekly: [],
    }, previousAt),
  ]]));
  const env = {
    PAGES_RESPONSE_R2: r2,
    OHISAMA_DB: {
      prepare() { throw new Error('unexpected D1 access on incremental refresh'); },
    },
  };

  const result = await refreshOptimizedOhisamaReadModel(env, {
    observed_at: observedAt,
    channel_id: 46,
    station_id: 99,
    is_broadcasting: 1,
    online_member_count: 120,
    total_member_count: 2001,
    reported_current_stream_count: 5030,
  }, observedAt);

  assert.equal(result.mode, 'incremental');
  assert.equal(result.daily_persisted, false);
  assert.equal(result.weekly_persisted, false);
  assert.equal(result.payload.weekly[0].period_key, '2026-09-28');
  assert.equal(r2.puts, 1);
});

test('Ohisama UTC day rollover persists completed daily and weekly summaries exactly once', async () => {
  const observedAt = Date.parse('2026-10-01T00:00:00Z');
  const previousAt = observedAt - 300_000;
  const r2 = new FakeR2(new Map([[
    HINATA_KEY,
    pageEnvelope({
      ok: true,
      model: 'hinata',
      updated_at: previousAt,
      latest: { observed_at: previousAt },
      history_24h: [{ observed_at: previousAt, online_member_count: 100, stream_count: 5000 }],
      daily: [{
        period_key: '2026-09-30',
        period_start: Date.parse('2026-09-30T00:00:00Z'),
        period_end: observedAt,
        sample_count: 288,
        listener_avg: 100,
        listener_min: 80,
        listener_max: 130,
        stream_start: 1000,
        stream_end: 5000,
        stream_growth: 4000,
        member_start: 2000,
        member_end: 2010,
        member_growth: 10,
        updated_at: previousAt,
      }],
      weekly: [],
    }, previousAt),
  ]]));
  const writes = [];
  const env = {
    PAGES_RESPONSE_R2: r2,
    OHISAMA_DB: {
      prepare(sql) {
        const statement = String(sql);
        assert.match(statement, /INSERT INTO sh_(?:daily|weekly)_summary/);
        return {
          bind() { return this; },
          async run() { writes.push(statement); return { meta: { changes: 1 } }; },
        };
      },
    },
  };

  const result = await refreshOptimizedOhisamaReadModel(env, {
    observed_at: observedAt,
    channel_id: 46,
    station_id: 99,
    is_broadcasting: 1,
    online_member_count: 105,
    total_member_count: 2011,
    reported_current_stream_count: 5010,
  }, observedAt);

  assert.equal(result.mode, 'incremental');
  assert.equal(result.daily_persisted, true);
  assert.equal(result.weekly_persisted, true);
  assert.equal(writes.length, 2);
  assert.match(writes[0], /INSERT INTO sh_daily_summary/);
  assert.match(writes[1], /INSERT INTO sh_weekly_summary/);
});

test('Ohisama collector uses R2 auth hot state and skips the per-run D1 state write', async () => {
  const observedAt = Date.parse('2026-09-30T12:05:00Z');
  const r2 = new FakeR2(new Map([[
    OHISAMA_AUTH_HOT_STATE_KEY,
    JSON.stringify({
      version: 1,
      authToken: 'cached-token',
      deviceUid: 'cached-device',
      tokenExpiresAt: null,
      d1CheckpointAt: observedAt - 300_000,
    }),
  ]]));
  const sql = [];
  const env = {
    CHANNEL_ALIAS: 'ohisama',
    AUTH_REFRESH_BEFORE_MS: 3_600_000,
    OHISAMA_D1_STATE_CHECKPOINT_MS: 3_600_000,
    PAGES_RESPONSE_R2: r2,
    OHISAMA_DB: {
      prepare(statement) {
        sql.push(String(statement));
        return {
          bind() { return this; },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
    },
  };
  const fetchResponse = {
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    async json() {
      return {
        id: 46,
        alias: 'ohisama',
        online_member_count: 120,
        total_member_count: 2001,
        current_station_id: 99,
        current_station: {
          id: 99,
          is_broadcasting: true,
          listener_count: 100,
          guest_count: 2,
          total_listens: 9000,
          streaming_party: { current_stream_count: 5000, stream_goal: 10000 },
        },
      };
    },
  };

  const result = await runOptimizedOhisamaCollectorScheduled(
    { cron: '*/5 * * * *' },
    env,
    {},
    {
      now: () => observedAt,
      fetch: async () => fetchResponse,
      registerFollowerTarget: async (_env, _snapshot, _observedAt, session) => {
        assert.equal(session.authToken, 'cached-token');
        assert.equal(session.deviceUid, 'cached-device');
        return false;
      },
    },
  );

  assert.equal(result.collected, true);
  assert.equal(result.d1_state_checkpointed, false);
  assert.equal(sql.length, 1);
  assert.match(sql[0], /INSERT INTO sh_minute_facts/);
  assert.doesNotMatch(sql[0], /sh_worker_collector_state/);
  assert.equal(r2.gets, 1);
  assert.ok(r2.puts >= 1);
});
