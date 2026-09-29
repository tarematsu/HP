import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTrackHistoryCycleStage,
  loadTrackHistoryDirtyDays,
} from '../src/pages-track-history-cycle.js';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 8, 29, 12);

test('dirty-day mode refreshes only explicitly dirty completed days', () => {
  const stage = createTrackHistoryCycleStage(
    NOW,
    { next_to: Date.UTC(2024, 4, 1), completed: true },
    { generated_at: NOW - DAY_MS },
    [{ play_date: '2026-09-27', revision: 7 }],
  );
  const recent = stage.tasks.filter((task) => task.kind === 'recent');
  assert.equal(stage.refresh_mode, 'dirty');
  assert.equal(recent.length, 8);
  assert.equal(recent.every((task) => task.dirty_play_date === '2026-09-27'), true);
  assert.equal(recent.every((task) => task.dirty_revision === 7), true);
  assert.equal(recent.at(-1).dirty_final, true);
  assert.equal(stage.tasks.filter((task) => task.kind === 'backfill').length, 0);
});

test('dirty-day loader uses one bounded marker query and excludes the open day', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(sql);
      return {
        bind(day, limit) {
          assert.equal(day, '2026-09-29');
          assert.equal(limit, 4);
          return {
            async all() {
              return { results: [{ play_date: '2026-09-28', revision: 2, updated_at: 3 }] };
            },
          };
        },
      };
    },
  };
  assert.deepEqual(await loadTrackHistoryDirtyDays(db, NOW), [
    { play_date: '2026-09-28', revision: 2, updated_at: 3 },
  ]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /FROM sh_track_history_dirty_days/);
  assert.match(calls[0], /play_date<\?/);
});
