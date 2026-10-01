import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OHISAMA_READ_MODEL_HOT_STATE_KEY,
  refreshOptimizedOhisamaReadModel,
} from '../src/ohisama-read-model-optimized.js';
import { mergeOhisamaPlaybackReadModelWithCadence } from '../src/ohisama-publication-cadence.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

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

function hotEnvelope(payload, updatedAt) {
  return JSON.stringify({ version: 1, updated_at: updatedAt, payload });
}

function basePayload(previousAt) {
  return {
    ok: true,
    model: 'hinata',
    updated_at: previousAt,
    latest: { observed_at: previousAt },
    history_24h: [{
      observed_at: previousAt,
      online_member_count: 100,
      total_member_count: 2000,
      stream_count: 5000,
      stream_delta_5m: null,
    }],
    daily: [{
      period_key: '2026-10-01',
      period_start: Date.parse('2026-10-01T00:00:00Z'),
      period_end: Date.parse('2026-10-02T00:00:00Z'),
      sample_count: 1,
      listener_avg: 100,
      listener_min: 100,
      listener_max: 100,
      stream_start: 5000,
      stream_end: 5000,
      stream_growth: 0,
      member_start: 2000,
      member_end: 2000,
      member_growth: 0,
    }],
  };
}

test('Ohisama recovery reads only the missing D1 interval', async () => {
  const observedAt = Date.parse('2026-10-01T12:30:00Z');
  const previousAt = observedAt - 30 * 60_000;
  const r2 = new FakeR2(new Map([[
    OHISAMA_READ_MODEL_HOT_STATE_KEY,
    hotEnvelope(basePayload(previousAt), previousAt),
  ]]));
  const sql = [];
  const env = {
    PAGES_RESPONSE_R2: r2,
    OHISAMA_DB: {
      prepare(statement) {
        sql.push(String(statement));
        assert.match(String(statement), /observed_at>\? AND observed_at<\?/);
        return {
          bind() { return this; },
          async all() {
            return {
              results: [
                {
                  channel_id: 46,
                  station_id: 99,
                  is_broadcasting: 1,
                  observed_at: previousAt + 5 * 60_000,
                  online_member_count: 101,
                  total_member_count: 2001,
                  reported_current_stream_count: 5010,
                },
                {
                  channel_id: 46,
                  station_id: 99,
                  is_broadcasting: 1,
                  observed_at: previousAt + 10 * 60_000,
                  online_member_count: 102,
                  total_member_count: 2002,
                  reported_current_stream_count: 5020,
                },
              ],
            };
          },
        };
      },
    },
  };

  const result = await refreshOptimizedOhisamaReadModel(env, {
    observed_at: observedAt,
    channel_id: 46,
    station_id: 99,
    is_broadcasting: 1,
    online_member_count: 110,
    total_member_count: 2010,
    reported_current_stream_count: 5100,
  }, observedAt);

  assert.equal(result.mode, 'recovery');
  assert.equal(result.recovery_rows, 2);
  assert.equal(sql.length, 1);
  assert.equal(result.payload.daily[0].sample_count, 4);
  assert.equal(result.payload.history_24h.length, 4);
});

test('Ohisama retry inside one five-minute bucket does not double-count daily samples', async () => {
  const previousAt = Date.parse('2026-10-01T12:30:10Z');
  const observedAt = Date.parse('2026-10-01T12:34:40Z');
  const r2 = new FakeR2(new Map([[
    OHISAMA_READ_MODEL_HOT_STATE_KEY,
    hotEnvelope(basePayload(previousAt), previousAt),
  ]]));
  const env = {
    PAGES_RESPONSE_R2: r2,
    OHISAMA_DB: {
      prepare() { throw new Error('same-bucket retry must not access D1'); },
    },
  };

  const result = await refreshOptimizedOhisamaReadModel(env, {
    observed_at: observedAt,
    channel_id: 46,
    station_id: 99,
    is_broadcasting: 1,
    online_member_count: 105,
    total_member_count: 2005,
    reported_current_stream_count: 5050,
  }, observedAt);

  assert.equal(result.mode, 'incremental');
  assert.equal(result.payload.daily[0].sample_count, 1);
  assert.equal(result.payload.history_24h.length, 1);
});

test('Ohisama public model can be published once from private hot payload', async () => {
  const observedAt = Date.parse('2026-10-01T12:30:00Z');
  const r2 = new FakeR2();
  const payload = basePayload(observedAt);
  payload.updated_at = observedAt;
  payload.latest.observed_at = observedAt;

  const result = await mergeOhisamaPlaybackReadModelWithCadence(
    { PAGES_RESPONSE_R2: r2 },
    null,
    { host_handle: 'host-a' },
    observedAt,
    null,
    payload,
  );

  assert.equal(result.published, true);
  assert.equal(r2.puts, 1);
  const raw = r2.values.get(pagesActionsR2ResponseKey('hinata'));
  const envelope = JSON.parse(raw);
  const body = JSON.parse(envelope.body);
  assert.equal(body.latest.host_handle, 'host-a');
  assert.equal(body.section_updated_at.current, observedAt);
});
