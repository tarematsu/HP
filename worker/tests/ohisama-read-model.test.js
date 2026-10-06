import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OHISAMA_PAGES_CADENCE_SECONDS,
  OHISAMA_PAGES_MODEL_KEY,
  mergeOhisamaDailyRows,
  nextOhisamaDailySummary,
  normalizeOhisamaHistory,
  ohisamaReadModelPayload,
  rollOhisamaHistory,
} from '../src/ohisama-read-model-core.js';

test('ohisama Pages model keeps the five-minute cadence', () => {
  assert.equal(OHISAMA_PAGES_MODEL_KEY, 'hinata');
  assert.equal(OHISAMA_PAGES_CADENCE_SECONDS, 300);
});

test('ohisama history derives a normalized five-minute stream increase', () => {
  const rows = normalizeOhisamaHistory([
    {
      observed_at: 1_000_000,
      online_member_count: 100,
      total_member_count: 2000,
      reported_current_stream_count: 5000,
    },
    {
      observed_at: 1_300_000,
      online_member_count: 110,
      total_member_count: 2001,
      reported_current_stream_count: 5030,
    },
    {
      observed_at: 1_900_000,
      online_member_count: 90,
      total_member_count: 2002,
      reported_current_stream_count: 5090,
    },
  ]);
  assert.equal(rows[0].stream_delta_5m, null);
  assert.equal(rows[1].stream_delta_5m, 30);
  assert.equal(rows[2].stream_delta_5m, 30);
});

test('ohisama Pages never substitutes total_listens for the current stream count', () => {
  const history = normalizeOhisamaHistory([
    { observed_at: 1_000_000, reported_total_listens: 5000 },
    { observed_at: 1_300_000, reported_total_listens: 5100 },
  ]);
  assert.equal(history[0].stream_count, null);
  assert.equal(history[1].stream_delta_5m, null);

  const value = ohisamaReadModelPayload({
    observed_at: 1_300_000,
    channel_id: 46,
    reported_total_listens: 9999,
    reported_current_stream_count: null,
  }, [], [], 1_300_000);
  assert.equal(value.latest.total_stream_count, null);
});

test('ohisama Pages payload exposes only aggregate current, chart, and daily data', () => {
  const value = ohisamaReadModelPayload({
    observed_at: 1_900_000,
    channel_id: 46,
    station_id: 99,
    is_broadcasting: 1,
    online_member_count: 123,
    total_member_count: 4567,
    reported_total_listens: 9999,
    reported_current_stream_count: 6789,
  }, [], [{
    period_key: '2026-09-30',
    period_start: 0,
    period_end: 86_400_000,
    sample_count: 10,
    listener_avg: 100.5,
    listener_min: 90,
    listener_max: 123,
    stream_start: 6000,
    stream_end: 6789,
    stream_growth: 789,
    member_start: 4500,
    member_end: 4567,
    member_growth: 67,
  }], 1_900_000);

  assert.equal(value.latest.online_member_count, 123);
  assert.equal(value.latest.total_stream_count, 6789);
  assert.equal(value.latest.total_member_count, 4567);
  assert.equal(value.daily[0].stream_growth, 789);
  assert.equal(value.daily[0].member_growth, 67);
  assert.equal('chat' in value, false);
  assert.equal('tracks' in value, false);
});

test('daily summary updates incrementally without changing the UTC day boundary', () => {
  const observedAt = Date.parse('2026-09-30T00:05:00Z');
  const existing = {
    period_key: '2026-09-30',
    period_start: Date.parse('2026-09-30T00:00:00Z'),
    period_end: Date.parse('2026-10-01T00:00:00Z'),
    sample_count: 2,
    listener_avg: 100,
    listener_min: 90,
    listener_max: 110,
    stream_start: 1000,
    stream_end: 1040,
    stream_growth: 40,
    member_start: 2000,
    member_end: 2001,
    member_growth: 1,
  };
  const next = nextOhisamaDailySummary(existing, {
    online_member_count: 130,
    total_member_count: 2003,
    reported_current_stream_count: 1090,
  }, observedAt);

  assert.equal(next.period_key, '2026-09-30');
  assert.equal(next.period_start, Date.parse('2026-09-30T00:00:00Z'));
  assert.equal(next.period_end, Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(next.sample_count, 3);
  assert.equal(next.listener_avg, 110);
  assert.equal(next.listener_min, 90);
  assert.equal(next.listener_max, 130);
  assert.equal(next.stream_start, 1000);
  assert.equal(next.stream_end, 1090);
  assert.equal(next.stream_growth, 90);
  assert.equal(next.member_start, 2000);
  assert.equal(next.member_end, 2003);
  assert.equal(next.member_growth, 3);
});

test('UTC midnight starts a new daily summary, corresponding to JST 09:00', () => {
  const before = nextOhisamaDailySummary(null, {
    online_member_count: 80,
    total_member_count: 3000,
    reported_current_stream_count: 5000,
  }, Date.parse('2026-09-30T23:59:59Z'));
  const after = nextOhisamaDailySummary(before, {
    online_member_count: 90,
    total_member_count: 3001,
    reported_current_stream_count: 5010,
  }, Date.parse('2026-10-01T00:00:00Z'));

  assert.equal(before.period_key, '2026-09-30');
  assert.equal(after.period_key, '2026-10-01');
  assert.equal(after.sample_count, 1);
  assert.equal(after.listener_avg, 90);
  assert.equal(after.stream_start, 5010);
  assert.equal(after.stream_growth, 0);
  assert.equal(after.member_start, 3001);
  assert.equal(after.member_growth, 0);
});

test('daily row merge replaces only the current UTC day and leaves past days fixed', () => {
  const rows = mergeOhisamaDailyRows([
    { period_key: '2026-09-30', sample_count: 10, stream_growth: 100 },
    { period_key: '2026-09-29', sample_count: 288, stream_growth: 5000 },
  ], {
    period_key: '2026-09-30',
    period_start: Date.parse('2026-09-30T00:00:00Z'),
    period_end: Date.parse('2026-10-01T00:00:00Z'),
    sample_count: 11,
    stream_growth: 120,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].period_key, '2026-09-30');
  assert.equal(rows[0].sample_count, 11);
  assert.equal(rows[1].period_key, '2026-09-29');
  assert.equal(rows[1].sample_count, 288);
  assert.equal(rows[1].stream_growth, 5000);
});

test('rolling history appends one point, replaces the same five-minute bucket, and prunes over 24 hours', () => {
  const observedAt = Date.parse('2026-09-30T12:00:00Z');
  const history = rollOhisamaHistory([
    {
      observed_at: observedAt - 24 * 60 * 60_000 - 1,
      online_member_count: 1,
      stream_count: 100,
    },
    {
      observed_at: observedAt - 5 * 60_000,
      online_member_count: 100,
      total_member_count: 2000,
      stream_count: 5000,
      stream_delta_5m: 20,
    },
    {
      observed_at: observedAt + 30_000,
      online_member_count: 999,
      stream_count: 9999,
    },
  ], {
    observed_at: observedAt,
    online_member_count: 110,
    total_member_count: 2001,
    reported_current_stream_count: 5030,
  }, observedAt);

  assert.equal(history.length, 2);
  assert.equal(history[0].observed_at, observedAt - 5 * 60_000);
  assert.equal(history[1].observed_at, observedAt);
  assert.equal(history[1].stream_delta_5m, 30);
});
