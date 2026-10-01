import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUDDIES_DASHBOARD_HOT_STATE_KEY,
  publishDashboardFromMinuteFact,
} from '../src/pages-dashboard-live-publisher.js';
import { BUDDIES_PLAYBACK_HOT_STATE_KEY } from '../src/buddies-playback-state.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

const DAY_MS = 24 * 60 * 60_000;
const DASHBOARD_KEY = pagesActionsR2ResponseKey('dashboard');

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
    const raw = String(value);
    this.puts.push(key);
    this.values.set(key, raw);
  }
}

function dayStart(timestamp) {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

function hotPayload(observedAt, overrides = {}) {
  return {
    ok: true,
    generated_at: observedAt,
    latest_observed_at: observedAt,
    latest: {
      observed_at: observedAt,
      channel_id: 46,
      station_id: 99,
      is_broadcasting: 1,
      online_member_count: 100,
      total_member_count: 2000,
      total_listens: 9000,
      current_stream_count: 5000,
      stream_goal: 10000,
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
    daily_change: {
      member_baseline_observed_at: observedAt - 60_000,
      listens_baseline_observed_at: observedAt - 60_000,
      member_cutoff_hour_jst: 16,
      listens_cutoff_hour_jst: 9,
      total_member_count: 10,
      total_listens: 100,
    },
    daily_summaries: {
      current_day_start: dayStart(observedAt),
    },
    queue: [],
    queue_status: null,
    queue_revision: '',
    _live_source_minute_at: observedAt,
    ...overrides,
  };
}

function dashboardHotState(payload, updatedAt) {
  return JSON.stringify({ version: 1, updated_at: updatedAt, payload });
}

function liveInput(observedAt, track = { track_id: 10, spotify_id: 'sp10' }) {
  return {
    snapshot: {
      channel_id: 46,
      station_id: 99,
      is_broadcasting: 1,
      listener_count: 95,
      online_member_count: 110,
      total_member_count: 2001,
      total_listens: 9030,
      current_stream_count: 5030,
      stream_goal: 10000,
    },
    queue: {
      station_id: 99,
      queue_id: 7,
      start_time: observedAt - 30_000,
      total_track_count: 1,
      is_paused: false,
      tracks: [{
        position: 0,
        duration_ms: 180000,
        title: 'Song',
        artist: '櫻坂46',
        thumbnail_url: 'https://example.test/song.jpg',
        ...track,
      }],
    },
  };
}

function fact(observedAt) {
  return {
    source_code: 1,
    channel_id: 46,
    station_id: 99,
    minute_at: observedAt,
    observed_at: observedAt,
    is_broadcasting: 1,
    listener_count: 95,
    online_member_count: 110,
    total_member_count: 2001,
    reported_total_listens: 9030,
    reported_current_stream_count: 5030,
  };
}

test('Buddies steady-state dashboard refresh performs zero D1 reads', async () => {
  const observedAt = Date.parse('2026-10-01T12:05:00Z');
  const previousAt = observedAt - 300_000;
  const r2 = new FakeR2(new Map([[
    BUDDIES_DASHBOARD_HOT_STATE_KEY,
    dashboardHotState(hotPayload(previousAt), previousAt),
  ]]));
  let d1Reads = 0;
  const env = {
    PAGES_RESPONSE_R2: r2,
    MINUTE_DB: {
      prepare() {
        d1Reads += 1;
        throw new Error('unexpected D1 read');
      },
    },
  };

  const result = await publishDashboardFromMinuteFact(
    env,
    liveInput(observedAt),
    fact(observedAt),
    { now: () => observedAt },
  );

  assert.equal(result.mode, 'incremental');
  assert.equal(d1Reads, 0);
  assert.deepEqual(r2.gets, [BUDDIES_DASHBOARD_HOT_STATE_KEY]);
  assert.deepEqual(r2.puts, [BUDDIES_DASHBOARD_HOT_STATE_KEY, DASHBOARD_KEY]);
  const hot = JSON.parse(r2.values.get(BUDDIES_DASHBOARD_HOT_STATE_KEY));
  assert.equal(hot.payload.history.at(-1).observed_at, observedAt);
  assert.equal(hot.payload.latest.current_stream_count, 5030);
});

test('Buddies dashboard gap recovery selects only the missing D1 interval', async () => {
  const observedAt = Date.parse('2026-10-01T12:20:00Z');
  const previousAt = observedAt - 20 * 60_000;
  const r2 = new FakeR2(new Map([[
    BUDDIES_DASHBOARD_HOT_STATE_KEY,
    dashboardHotState(hotPayload(previousAt), previousAt),
  ]]));
  const queries = [];
  const binds = [];
  const env = {
    PAGES_RESPONSE_R2: r2,
    MINUTE_DB: {
      prepare(sql) {
        queries.push(String(sql));
        return {
          bind(...args) {
            binds.push(args);
            return this;
          },
          async all() {
            return {
              results: [5, 10, 15].map((minutes) => ({
                channel_id: 46,
                station_id: 99,
                minute_at: previousAt + minutes * 60_000,
                observed_at: previousAt + minutes * 60_000,
                is_broadcasting: 1,
                listener_count: 90,
                online_member_count: 100 + minutes,
                total_member_count: 2000,
                reported_total_listens: 9000 + minutes,
                reported_current_stream_count: 5000 + minutes,
              })),
            };
          },
        };
      },
    },
  };

  const result = await publishDashboardFromMinuteFact(
    env,
    liveInput(observedAt),
    fact(observedAt),
    { now: () => observedAt },
  );

  assert.equal(result.mode, 'recovery');
  assert.equal(result.recovery_rows, 3);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /FROM sh_minute_facts/);
  assert.match(queries[0], /minute_at>\? AND minute_at<\?/);
  assert.deepEqual(binds[0], [46, previousAt, observedAt]);
  const hot = JSON.parse(r2.values.get(BUDDIES_DASHBOARD_HOT_STATE_KEY));
  assert.equal(hot.payload.history.at(-1).observed_at, observedAt);
  assert.ok(hot.payload.history.some((row) => row.observed_at === previousAt + 10 * 60_000));
});

test('Buddies dashboard retries in the same five-minute bucket are idempotent', async () => {
  const observedAt = Date.parse('2026-10-01T12:05:00Z');
  const r2 = new FakeR2(new Map([[
    BUDDIES_DASHBOARD_HOT_STATE_KEY,
    dashboardHotState(hotPayload(observedAt), observedAt),
  ]]));
  const env = {
    PAGES_RESPONSE_R2: r2,
    MINUTE_DB: {
      prepare() { throw new Error('same bucket retry must not read D1'); },
    },
  };

  const result = await publishDashboardFromMinuteFact(
    env,
    liveInput(observedAt),
    fact(observedAt),
    { now: () => observedAt + 30_000 },
  );

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'already-published');
  assert.equal(r2.puts.length, 0);
});

test('Buddies dashboard reuses playback hot-state canonical ids before D1 lookup', async () => {
  const observedAt = Date.parse('2026-10-01T12:05:00Z');
  const previousAt = observedAt - 300_000;
  const r2 = new FakeR2(new Map([
    [
      BUDDIES_DASHBOARD_HOT_STATE_KEY,
      dashboardHotState(hotPayload(previousAt), previousAt),
    ],
    [
      BUDDIES_PLAYBACK_HOT_STATE_KEY,
      JSON.stringify({
        version: 2,
        updated_at: observedAt,
        queue: [{
          track_id: 77,
          spotify_id: 'shared-track',
          title: 'Canonical Song',
          artist: '櫻坂46',
        }],
      }),
    ],
  ]));
  let d1Reads = 0;
  const env = {
    PAGES_RESPONSE_R2: r2,
    MINUTE_DB: {
      prepare() {
        d1Reads += 1;
        throw new Error('playback hot-state should avoid canonical D1 lookup');
      },
    },
  };

  const result = await publishDashboardFromMinuteFact(
    env,
    liveInput(observedAt, { spotify_id: 'shared-track' }),
    fact(observedAt),
    { now: () => observedAt },
  );

  assert.equal(result.mode, 'incremental');
  assert.equal(d1Reads, 0);
  assert.deepEqual(r2.gets, [BUDDIES_DASHBOARD_HOT_STATE_KEY, BUDDIES_PLAYBACK_HOT_STATE_KEY]);
  const envelope = JSON.parse(r2.values.get(DASHBOARD_KEY));
  const payload = JSON.parse(envelope.body);
  assert.equal(payload.queue[0].track_id, 77);
});
