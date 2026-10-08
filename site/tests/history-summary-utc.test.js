import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentPeriodKey,
  expectedPeriodBounds,
  parseRangeStart,
} from '../functions/lib/period-completeness.js';

test('summary period boundaries and range starts use UTC', () => {
  const weekly = expectedPeriodBounds('weekly', '2026-07-13');
  assert.deepEqual(weekly, {
    start: Date.parse('2026-07-13T00:00:00Z'),
    end: Date.parse('2026-07-20T00:00:00Z'),
  });
  const monthly = expectedPeriodBounds('monthly', '2026-07');
  assert.equal(monthly.start, Date.parse('2026-07-01T00:00:00Z'));
  assert.equal(parseRangeStart('weekly', '2026-07-13', '2026-01-01'), Date.parse('2026-07-13T00:00:00Z'));
  assert.equal(currentPeriodKey('weekly', Date.parse('2026-07-13T00:01:00Z')), '2026-07-13');
});

