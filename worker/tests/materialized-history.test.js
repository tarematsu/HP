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

function environment(calls, rows = [summaryRow()]) {
  const forbidden = new Proxy({}, {
    get() { assert.fail('summary-only materialization must not inspect raw history databases'); },
  });
  return {
    DB: forbidden,
    MINUTE_DB: forbidden,
    OTHER_DB: {
      prepare(sql) {
        calls.push({ sql, bindings: null });
        assert.match(sql, /FROM sh_daily_summary/);
        assert.doesNotMatch(sql, /sh_channel_snapshots|sh_minute_facts/);
        return {
          bind(...bindings) {
            calls.at(-1).bindings = bindings;
            return { all: async () => ({ results: rows }) };
          },
        };
      },
    },
  };
}

test('Actions history renderer reads only completed daily summary rows', async () => {
  const calls = [];
  const result = await loadMaterializedSummary(
    environment(calls),
    'daily',
    '2026-07-01',
    '2026-07-28',
    Date.parse('2026-07-28T01:00:00Z'),
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].bindings, ['2026-07-01', '2026-07-28', '2026-07-28', 800]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].period_complete, true);
  assert.equal(result.live_overlay_count, 0);
  assert.equal(result.live_source, 'summary-only');
  assert.equal(result.storage_source, 'other.sh_daily_summary');
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
  assert.equal(calls.length, 1);
});