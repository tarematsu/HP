import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STATIONHEAD_READ_MODEL_KEYS,
  mergeStationheadDailyRows,
  nextStationheadDailySummary,
  rollStationheadHistory,
  rollupStationheadWeekly,
  stationheadAggregateReadModelPayload,
  stationheadReadModelGapMode,
  stationheadReadModelKey,
} from '../../packages/sh-shared/stationhead-read-models.mjs';
import { STATIONHEAD_SOURCE_PROFILES } from '../../packages/sh-shared/stationhead-source.mjs';

test('Stationhead source-scoped read-model core resolves all public model keys', () => {
  assert.deepEqual(STATIONHEAD_READ_MODEL_KEYS,
    Object.fromEntries(Object.entries(STATIONHEAD_SOURCE_PROFILES).map(([source, profile]) => [source, profile.modelKey])));
  assert.equal(stationheadReadModelKey('buddies'), 'dashboard');
  assert.equal(stationheadReadModelKey('ohisama'), 'hinata');
  assert.equal(stationheadReadModelKey('nogizaka46smej'), 'nogizaka-listening-party');
});

test('Stationhead source-scoped current/history/daily/weekly core keeps one aggregation contract', () => {
  const observedAt = Date.parse('2026-10-01T00:05:00Z');
  const daily = nextStationheadDailySummary(null, {
    online_member_count: 100,
    total_member_count: 2000,
    reported_current_stream_count: 5000,
  }, observedAt);
  const next = nextStationheadDailySummary(daily, {
    online_member_count: 120,
    total_member_count: 2002,
    reported_current_stream_count: 5040,
  }, observedAt + 300_000);
  const rows = mergeStationheadDailyRows([], next);
  const weekly = rollupStationheadWeekly(rows, observedAt + 300_000);
  const history = rollStationheadHistory([], {
    observed_at: observedAt,
    online_member_count: 100,
    total_member_count: 2000,
    reported_current_stream_count: 5000,
  }, observedAt);
  const payload = stationheadAggregateReadModelPayload(
    'ohisama',
    { observed_at: observedAt, channel_id: 46, station_id: 99, online_member_count: 100,
      total_member_count: 2000, reported_current_stream_count: 5000 },
    history,
    rows,
    observedAt,
  );

  assert.equal(next.sample_count, 2);
  assert.equal(next.listener_avg, 110);
  assert.equal(weekly[0].stream_growth, 40);
  assert.equal(payload.model, 'hinata');
  assert.equal(payload.source, 'ohisama');
  assert.equal(payload.history_24h.length, 1);
});

test('Stationhead read-model gap policy is source-independent', () => {
  const now = 1_000_000;
  assert.equal(stationheadReadModelGapMode(now, now + 300_000), 'incremental');
  assert.equal(stationheadReadModelGapMode(now, now + 30 * 60_000), 'recovery');
  assert.equal(stationheadReadModelGapMode(now, now + 2 * 24 * 60 * 60_000), 'bootstrap');
});
