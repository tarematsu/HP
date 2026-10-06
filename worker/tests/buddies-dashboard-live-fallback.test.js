import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { publishDashboardFallbackFromMinuteFact } from '../src/pages-dashboard-live-fallback.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

const HOT_STATE_KEY = 'stationhead/buddies/dashboard-hot-state.json';
const DASHBOARD_KEY = pagesR2ResponseKey('dashboard');

class FakeR2 {
  constructor(initial = new Map()) {
    this.values = initial;
    this.gets = [];
    this.puts = [];
  }

  async get(key) {
    this.gets.push(key);
    const raw = this.values.get(key);
    if (raw == null) return null;
    return {
      async json() { return JSON.parse(raw); },
      async text() { return raw; },
    };
  }

  async put(key, value) {
    this.puts.push(key);
    this.values.set(key, String(value));
  }
}

function stalePayload(observedAt) {
  return {
    ok: true,
    generated_at: observedAt,
    latest_observed_at: observedAt,
    latest: {
      observed_at: observedAt,
      channel_id: 46,
      station_id: 99,
      online_member_count: 100,
      total_member_count: 2000,
      total_listens: 9000,
      current_stream_count: 5000,
    },
    history: [{
      observed_at: observedAt,
      listener_count: 90,
      online_member_count: 100,
      total_member_count: 2000,
      total_listens: 9000,
      current_stream_count: 5000,
    }],
    previous_day_history: [],
    stream_5m_history: [],
    daily_change: null,
    daily_summaries: null,
    queue: [],
    queue_status: null,
    queue_revision: '',
    _live_source_minute_at: observedAt,
  };
}

test('Buddies dashboard fallback advances a stale current model without D1', async () => {
  const previousAt = Date.parse('2026-10-01T12:00:00Z');
  const observedAt = Date.parse('2026-10-01T12:25:00Z');
  const r2 = new FakeR2(new Map([[
    HOT_STATE_KEY,
    JSON.stringify({ version: 1, updated_at: previousAt, payload: stalePayload(previousAt) }),
  ]]));
  const env = {
    PAGES_RESPONSE_R2: r2,
    MINUTE_DB: {
      prepare() { throw new Error('fallback must not read D1'); },
    },
  };
  const input = {
    snapshot: {
      channel_id: 46,
      station_id: 99,
      is_broadcasting: 1,
      listener_count: 95,
      online_member_count: 125,
      total_member_count: 2005,
      total_listens: 9125,
      current_stream_count: 5125,
    },
    queue: {
      station_id: 99,
      queue_id: 7,
      start_time: observedAt - 30_000,
      total_track_count: 1,
      is_paused: false,
      tracks: [{
        title: 'Fallback Song',
        artist: '櫻坂46',
        spotify_id: 'fallback-track',
        duration_ms: 180000,
      }],
    },
  };
  const fact = {
    source_code: 1,
    channel_id: 46,
    station_id: 99,
    minute_at: observedAt,
    observed_at: observedAt,
    is_broadcasting: 1,
    listener_count: 95,
    online_member_count: 125,
    total_member_count: 2005,
    reported_total_listens: 9125,
    reported_current_stream_count: 5125,
  };

  const result = await publishDashboardFallbackFromMinuteFact(
    env,
    input,
    fact,
    { now: () => observedAt, cause: new Error('gap recovery failed') },
  );

  assert.equal(result.mode, 'fallback');
  assert.equal(result.skipped, false);
  assert.deepEqual(r2.puts, [HOT_STATE_KEY, DASHBOARD_KEY]);
  const envelope = JSON.parse(r2.values.get(DASHBOARD_KEY));
  const payload = JSON.parse(envelope.body);
  assert.equal(payload.latest_observed_at, observedAt);
  assert.equal(payload.latest.online_member_count, 125);
  assert.equal(payload.latest.current_stream_count, 5125);
  assert.equal(payload.history.at(-1).observed_at, observedAt);
  assert.equal(payload.queue[0].title, 'Fallback Song');
  assert.equal(payload.queue[0].is_current, true);
  assert.equal(payload._live_source_minute_at, observedAt);
  assert.equal(payload._live_fallback_at, observedAt);
});

test('minute fact writer invokes D1-free dashboard fallback after primary publication failure', () => {
  const source = readFileSync(new URL('../src/minute-facts-fast-store.js', import.meta.url), 'utf8');
  assert.match(source, /pages-dashboard-live-fallback\.js/);
  assert.match(source, /publishDashboardFallbackFromMinuteFact/);
  assert.match(source, /pages_dashboard_live_fallback_failed/);
});
