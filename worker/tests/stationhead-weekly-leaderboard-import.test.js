import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RANKING_TYPE,
  SOURCE_SHEET,
  UNIQUE_INDEX,
  validateWeeklyLeaderboardPayload,
  weeklyWindow,
} from '../scripts/import-stationhead-weekly-leaderboard.mjs';

const MONDAY = '2026-09-21';
const DIGEST = 'b'.repeat(64);
const observedAt = Date.UTC(2026, 8, 22, 12, 0, 0);

function rows(count = 100) {
  return Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    channel_name: `Host${index + 1}`,
  }));
}

function payload(overrides = {}) {
  return {
    version: 1,
    ranking_date: MONDAY,
    observed_at: observedAt,
    digest: DIGEST,
    row_count: 100,
    rows: rows(),
    ...overrides,
  };
}

test('weekly leaderboard import maps to the existing ranking table contract', () => {
  assert.equal(RANKING_TYPE, '週間リーダーボード');
  assert.equal(SOURCE_SHEET, 'stationhead-r2-weekly');
  assert.equal(UNIQUE_INDEX, 'uq_other_channel_rankings_week_host');
  const normalized = validateWeeklyLeaderboardPayload(payload());
  assert.equal(normalized.ranking_date, MONDAY);
  assert.equal(normalized.row_count, 100);
  assert.deepEqual(normalized.rows[0], { rank: 1, channel_name: 'host1' });
  assert.deepEqual(normalized.rows.at(-1), { rank: 100, channel_name: 'host100' });
});

test('weekly window covers Monday 18:00 JST through Wednesday 00:00 JST', () => {
  assert.deepEqual(weeklyWindow(MONDAY), {
    start: Date.UTC(2026, 8, 21, 9, 0, 0),
    end: Date.UTC(2026, 8, 22, 15, 0, 0),
  });
  assert.doesNotThrow(() => validateWeeklyLeaderboardPayload(payload({
    observed_at: Date.UTC(2026, 8, 21, 9, 0, 0),
  })));
  assert.doesNotThrow(() => validateWeeklyLeaderboardPayload(payload({
    observed_at: Date.UTC(2026, 8, 22, 14, 59, 59, 999),
  })));
  assert.throws(() => validateWeeklyLeaderboardPayload(payload({
    observed_at: Date.UTC(2026, 8, 21, 8, 59, 59, 999),
  })), /outside Monday-night-through-Tuesday/);
  assert.throws(() => validateWeeklyLeaderboardPayload(payload({
    observed_at: Date.UTC(2026, 8, 22, 15, 0, 0),
  })), /outside Monday-night-through-Tuesday/);
});

test('weekly import rejects incomplete and ambiguous snapshots before D1 writes', () => {
  assert.throws(() => validateWeeklyLeaderboardPayload(payload({
    rows: rows(99),
    row_count: 99,
  })), /exactly 100 rows/);

  const duplicateHost = rows();
  duplicateHost[10] = { rank: 11, channel_name: 'host1' };
  assert.throws(() => validateWeeklyLeaderboardPayload(payload({
    rows: duplicateHost,
  })), /duplicate leaderboard channel/);

  const rankGap = rows();
  rankGap[30] = { rank: 90, channel_name: 'host31' };
  assert.throws(() => validateWeeklyLeaderboardPayload(payload({
    rows: rankGap,
  })), /duplicate leaderboard rank|leaderboard ranks must be contiguous/);

  assert.throws(() => validateWeeklyLeaderboardPayload(payload({
    ranking_date: '2026-09-22',
  })), /Monday/);
  assert.throws(() => validateWeeklyLeaderboardPayload(payload({
    digest: 'not-a-digest',
  })), /SHA-256/);
});
