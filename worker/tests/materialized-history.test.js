import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadMaterializedSummary,
  onRequestGet,
} from '../../site/functions/lib/materialized-history.js';

const DAY = 86_400_000;
const PERIOD_START = Date.parse('2026-07-26T00:00:00Z');
const PERIOD_END = PERIOD_START + DAY - 60_000;

function summaryRow(overrides = {}) {
  return {
    period_key: '2026-07-26',
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    sample_count: 1440,
    reliable_sample_count: 1440,
    listener_avg: 20,
    listener_min: 10,
    listener_max: 30,
    stream_start: 1000,
    stream_end: 1100,
    stream_growth: 100,
    member_start: 200,
    member_end: 205,
    member_growth: 5,
    likes_max: null,
    distinct_tracks: null,
    primary_host: 'host',
    quality_score: 1,
    quality_flags: '["daily_reconciled"]',
    ...overrides,
  };
}

function environment(calls, rows = [summaryRow()], trackRows = [{
  period_key: '2026-07-26', track_count: 17,
}]) {
  const forbidden = new Proxy({}, {
    get() { assert.fail('history materialization must not inspect raw history databases'); },
  });
  const otherDb = {
    prepare(sql) {
      const call = { source: /^\s*UPDATE\b/i.test(sql) ? 'other-update' : 'other-select', sql, bindings: null };
      calls.push(call);
      if (call.source === 'other-select') {
        assert.match(sql, /FROM sh_daily_summary/);
        assert.doesNotMatch(sql, /sh_channel_snapshots|sh_minute_facts/);
      } else {
        assert.match(sql, /UPDATE sh_daily_summary/);
        assert.match(sql, /SET distinct_tracks=\?,updated_at=\?/);
      }
      return {
        bind(...bindings) {
          call.bindings = bindings;
          if (call.source === 'other-select') return { all: async () => ({ results: rows }) };
          return { run: async () => ({ success: true }) };
        },
      };
    },
    async batch(statements) {
      return statements.map(() => ({ success: true }));
    },
  };
  return {
    DB: forbidden,
    MINUTE_DB: {
      prepare(sql) {
        const call = { source: 'minute', sql, bindings: null };
        calls.push(call);
        assert.match(sql, /FROM sh_pages_track_history_read_model/);
        assert.match(sql, /SUM\(CASE/);
        assert.match(sql, /json_extract\(row_json,'\$\.play_count'\)/);
        assert.doesNotMatch(sql, /sh_channel_snapshots|sh_minute_facts/);
        return {
          bind(...bindings) {
            call.bindings = bindings;
            return { all: async () => ({ results: trackRows }) };
          },
        };
      },
    },
    OTHER_DB: otherDb,
  };
}

test('Actions history renderer persists missing historical track totals in OTHER_DB', async () => {
  const calls = [];
  const now = Date.parse('2026-07-28T01:00:00Z');
  const result = await loadMaterializedSummary(
    environment(calls),
    'daily',
    '2026-07-01',
    '2026-07-28',
    now,
  );

  assert.deepEqual(calls.find((call) => call.source === 'other-select').bindings, [
    '2026-06-30', '2026-07-28', '2026-07-28', 801,
  ]);
  assert.deepEqual(calls.find((call) => call.source === 'minute').bindings, [
    '2026-07-01', '2026-07-28',
  ]);
  assert.deepEqual(calls.find((call) => call.source === 'other-update').bindings, [
    17, now, '2026-07-26',
  ]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].period_complete, true);
  assert.equal(result.rows[0].distinct_tracks, 17);
  assert.equal(result.live_overlay_count, 0);
  assert.equal(result.live_source, 'summary-only');
  assert.equal(result.storage_source, 'other.sh_daily_summary+minute.sh_pages_track_history_read_model');
});

test('persisted historical track totals skip request-time MINUTE_DB aggregation', async () => {
  const calls = [];
  const result = await loadMaterializedSummary(
    environment(calls, [summaryRow({ distinct_tracks: 17 })]),
    'daily',
    '2026-07-26',
    '2026-07-26',
    Date.parse('2026-07-28T01:00:00Z'),
  );

  assert.equal(calls.filter((call) => call.source === 'minute').length, 0);
  assert.equal(calls.filter((call) => call.source === 'other-update').length, 0);
  assert.equal(result.rows[0].distinct_tracks, 17);
  assert.equal(result.storage_source, 'other.sh_daily_summary');
});

test('daily materialization preserves member boundaries already persisted in OTHER_DB', async () => {
  const calls = [];
  const current = summaryRow({
    member_start: 198,
    member_end: 205,
    member_growth: 7,
    distinct_tracks: 17,
  });

  const result = await loadMaterializedSummary(
    environment(calls, [current]),
    'daily',
    '2026-07-26',
    '2026-07-26',
    Date.parse('2026-07-28T01:00:00Z'),
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].period_key, '2026-07-26');
  assert.equal(result.rows[0].member_start, 198);
  assert.equal(result.rows[0].member_end, 205);
  assert.equal(result.rows[0].member_growth, 7);
  assert.deepEqual(calls.find((call) => call.source === 'other-select').bindings, [
    '2026-07-25', '2026-07-26', '2026-07-28', 801,
  ]);
});

test('daily materialization rejects sample counts above one row per minute', async () => {
  const calls = [];
  await assert.rejects(
    loadMaterializedSummary(
      environment(calls, [summaryRow({ sample_count: 1441, reliable_sample_count: 1441 })]),
      'daily',
      '2026-07-01',
      '2026-07-28',
      Date.parse('2026-07-28T01:00:00Z'),
    ),
    /daily summary 2026-07-26 has invalid sample_count: 1441/,
  );
});

test('materialized history response keeps the public payload shape without raw D1 reads', async () => {
  const calls = [];
  const response = await onRequestGet({
    request: new Request('https://materializer.test/api/history?mode=daily&from=2026-07-01&to=2026-07-28'),
    env: environment(calls),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'daily');
  assert.equal(payload.timezone, 'UTC');
  assert.equal(payload.live_source, 'summary-only');
  assert.equal(payload.live_overlay_count, 0);
  assert.equal(payload.rows[0].distinct_tracks, 17);
  assert.equal(calls.filter((call) => call.source === 'minute').length, 1);
  assert.equal(calls.filter((call) => call.source === 'other-update').length, 1);
});
