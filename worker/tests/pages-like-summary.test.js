import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLikeRankingSummary } from '../src/pages-track-history-stage.js';

const NOW = Date.UTC(2026, 8, 30, 4, 0, 0);
const DAY = 86_400_000;

test('likes read model derives previous-day delta from the already-loaded prior status', () => {
  const summary = buildLikeRankingSummary(
    { summary: { track_count: 2, total_like_count: 320 }, rows: [] },
    {
      generated_at: NOW - DAY,
      ranking_summary: { track_count: 2, total_like_count: 250 },
      ranking: [],
    },
    NOW,
  );

  assert.equal(summary.total_like_count, 320);
  assert.equal(summary.total_like_count_day, '2026-09-30');
  assert.equal(summary.previous_day_total_like_count, 250);
  assert.equal(summary.previous_day_total_like_count_day, '2026-09-29');
  assert.equal(summary.total_like_count_previous_day_delta, 70);
});

test('likes read model preserves the previous-day baseline across same-day refreshes', () => {
  const summary = buildLikeRankingSummary(
    { summary: { total_like_count: 335 }, rows: [] },
    {
      generated_at: NOW - 60_000,
      ranking_summary: {
        total_like_count: 330,
        total_like_count_day: '2026-09-30',
        previous_day_total_like_count: 250,
        previous_day_total_like_count_day: '2026-09-29',
      },
    },
    NOW,
  );

  assert.equal(summary.previous_day_total_like_count, 250);
  assert.equal(summary.total_like_count_previous_day_delta, 85);
});

test('likes read model does not compare against a stale non-previous-day status', () => {
  const summary = buildLikeRankingSummary(
    { summary: { total_like_count: 335 }, rows: [] },
    {
      generated_at: NOW - 2 * DAY,
      ranking_summary: { total_like_count: 200 },
    },
    NOW,
  );

  assert.equal(summary.previous_day_total_like_count, null);
  assert.equal(summary.previous_day_total_like_count_day, null);
  assert.equal(summary.total_like_count_previous_day_delta, null);
});
