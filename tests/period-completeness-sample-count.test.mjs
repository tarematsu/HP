import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DAILY_EXPECTED_SAMPLE_COUNT,
  DAILY_MINIMUM_SAMPLE_COUNT,
  applySummaryCompleteness,
  expectedPeriodBounds,
} from '../site/functions/lib/period-completeness.js';

const NOW = Date.parse('2026-07-12T12:00:00Z');

function dailyRow(sampleCount) {
  const bounds = expectedPeriodBounds('daily', '2026-07-10');
  return {
    period_key: '2026-07-10',
    period_start: bounds.start + 5 * 60_000,
    period_end: bounds.end - 5 * 60_000,
    sample_count: sampleCount,
    reliable_sample_count: sampleCount,
    stream_growth: 1234,
    member_growth: 12,
    quality_flags: '[]',
  };
}

test('daily completeness expects 1440 samples and accepts bounded minor gaps', () => {
  assert.equal(DAILY_EXPECTED_SAMPLE_COUNT, 1440);
  assert.equal(DAILY_MINIMUM_SAMPLE_COUNT, 1400);

  for (const sampleCount of [1400, 1420, 1440]) {
    const result = applySummaryCompleteness([dailyRow(sampleCount)], 'daily', NOW);
    assert.equal(result.excludedCount, 0, `${sampleCount} samples should satisfy daily coverage`);
    assert.equal(result.rows[0].period_complete, true);
    assert.equal(result.rows[0].stream_growth, 1234);
  }
});

test('daily completeness rejects materially missing minute facts', () => {
  const result = applySummaryCompleteness([dailyRow(1399)], 'daily', NOW);
  assert.equal(result.excludedCount, 1);
  assert.equal(result.rows[0].period_complete, false);
  assert.equal(result.rows[0].stream_growth, null);
  assert.equal(result.rows[0].member_growth, null);
  assert.ok(result.rows[0].exclusion_reasons.includes('insufficient_samples'));
  assert.match(result.rows[0].quality_flags, /incomplete_sample_count/);
});

test('daily completeness rejects more than one sample per minute', () => {
  const result = applySummaryCompleteness([dailyRow(1441)], 'daily', NOW);
  assert.equal(result.excludedCount, 1);
  assert.equal(result.rows[0].period_complete, false);
  assert.ok(result.rows[0].exclusion_reasons.includes('excess_samples'));
  assert.match(result.rows[0].quality_flags, /excess_sample_count/);
});
