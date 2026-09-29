import assert from 'node:assert/strict';
import test from 'node:test';

import { minuteFactDue } from '../src/prepared-collector-runner.js';

test('live minute facts are due only on five-minute boundaries', () => {
  const base = Date.UTC(2026, 8, 30, 0, 0, 0);
  for (let minute = 0; minute < 15; minute += 1) {
    const observedAt = base + minute * 60_000 + 42_000;
    assert.equal(minuteFactDue(observedAt), minute % 5 === 0, `minute=${minute}`);
  }
});

test('five-minute cadence rejects invalid timestamps', () => {
  assert.equal(minuteFactDue(Number.NaN), false);
  assert.equal(minuteFactDue('invalid'), false);
});
