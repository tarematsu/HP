import test from 'node:test';
import assert from 'node:assert/strict';

import {
  backfillDays,
  backfillTrackHistoryRange,
  DEFAULT_BACKFILL_START,
  DEFAULT_BACKFILL_END,
} from '../worker/scripts/backfill-track-history-range-actions.mjs';

test('played-tracks range backfill covers June through September 22 inclusively', () => {
  assert.equal(DEFAULT_BACKFILL_START, '2026-06-01');
  assert.equal(DEFAULT_BACKFILL_END, '2026-09-22');
  const days = backfillDays(DEFAULT_BACKFILL_START, DEFAULT_BACKFILL_END);
  assert.equal(days[0], '2026-06-01');
  assert.equal(days.at(-1), '2026-09-22');
  assert.equal(days.length, 114);
});

test('played-tracks range backfill rejects reversed ranges', () => {
  assert.throws(
    () => backfillDays('2026-09-22', '2026-06-01'),
    /end precedes start/,
  );
});

test('played-tracks range backfill skips already materialized days before expensive repair', async () => {
  const seenDays = [];
  const db = {
    prepare() {
      return {
        bind(day) {
          seenDays.push(day);
          return {
            async first() {
              return { row_count: 5, total_plays: 25 };
            },
          };
        },
      };
    },
  };
  const originalLog = console.log;
  console.log = () => {};
  try {
    const result = await backfillTrackHistoryRange({
      db,
      start: '2026-09-21',
      end: '2026-09-22',
      delayMs: 0,
    });
    assert.deepEqual(seenDays, ['2026-09-21', '2026-09-22']);
    assert.equal(result.requested_days, 2);
    assert.equal(result.existing_days, 2);
    assert.equal(result.generated_days, 0);
    assert.equal(result.generated_rows, 0);
  } finally {
    console.log = originalLog;
  }
});
