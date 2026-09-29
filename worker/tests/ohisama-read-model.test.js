import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OHISAMA_PAGES_CADENCE_SECONDS,
  OHISAMA_PAGES_MODEL_KEY,
  normalizeOhisamaHistory,
  ohisamaReadModelPayload,
} from '../src/ohisama-read-model.js';

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
