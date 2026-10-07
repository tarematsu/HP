import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERIOD_BOUNDARY_TOLERANCE_MS,
  evaluatePeriodCompleteness,
  expectedPeriodBounds,
} from '../site/functions/lib/period-completeness.js';

test('both sides of each boundary are accepted within fifteen minutes', () => {
  const bounds = expectedPeriodBounds('daily', '2026-06-30');
  for (const offset of [-PERIOD_BOUNDARY_TOLERANCE_MS, PERIOD_BOUNDARY_TOLERANCE_MS]) {
    const result = evaluatePeriodCompleteness({
      mode: 'daily',
      periodKey: '2026-06-30',
      firstObservedAt: bounds.start + offset,
      lastObservedAt: bounds.end - offset,
      now: bounds.end + PERIOD_BOUNDARY_TOLERANCE_MS + 1,
    });
    assert.equal(result.complete, true);
  }
});

test('observations outside either tolerance edge are rejected', () => {
  const bounds = expectedPeriodBounds('daily', '2026-06-30');
  const outside = PERIOD_BOUNDARY_TOLERANCE_MS + 1;
  const entrance = evaluatePeriodCompleteness({
    mode: 'daily', periodKey: '2026-06-30',
    firstObservedAt: bounds.start - outside, lastObservedAt: bounds.end,
    now: bounds.end + outside,
  });
  const exit = evaluatePeriodCompleteness({
    mode: 'daily', periodKey: '2026-06-30',
    firstObservedAt: bounds.start, lastObservedAt: bounds.end + outside,
    now: bounds.end + outside,
  });
  assert.deepEqual(entrance.reasons, ['missing_period_start']);
  assert.deepEqual(exit.reasons, ['missing_period_end']);
});

test('the period stays current through the exit grace window', () => {
  const bounds = expectedPeriodBounds('daily', '2026-06-30');
  const result = evaluatePeriodCompleteness({
    mode: 'daily', periodKey: '2026-06-30',
    firstObservedAt: bounds.start, lastObservedAt: bounds.end,
    now: bounds.end + PERIOD_BOUNDARY_TOLERANCE_MS - 1,
  });
  assert.equal(result.complete, false);
  assert.ok(result.reasons.includes('current_period'));
});

