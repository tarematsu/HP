import assert from 'node:assert/strict';
import test from 'node:test';

import { minuteFactDue } from '../src/prepared-collector-runner.js';

const base = Date.UTC(2026, 8, 30, 0, 0, 0);
const minute = (value, seconds = 42) => base + value * 60_000 + seconds * 1_000;

test('live minute facts are emitted once when entering each five-minute bucket', () => {
  assert.equal(minuteFactDue(minute(0), null), true);
  assert.equal(minuteFactDue(minute(1), minute(0)), false);
  assert.equal(minuteFactDue(minute(4), minute(3)), false);
  assert.equal(minuteFactDue(minute(5), minute(4)), true);
  assert.equal(minuteFactDue(minute(6), minute(5)), false);
  assert.equal(minuteFactDue(minute(10), minute(9)), true);
});

test('five-minute cadence catches up when the exact boundary invocation was missed', () => {
  assert.equal(minuteFactDue(minute(6), minute(4)), true);
  assert.equal(minuteFactDue(minute(7), minute(6)), false);
  assert.equal(minuteFactDue(minute(11), minute(9)), true);
});

test('five-minute cadence rejects invalid current timestamps', () => {
  assert.equal(minuteFactDue(Number.NaN, minute(0)), false);
  assert.equal(minuteFactDue('invalid', minute(0)), false);
});
