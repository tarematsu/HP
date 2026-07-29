import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('normalized points require finite non-negative values', () => {
  assert.match(policy, /Number\.isFinite\(timestamp\) && timestamp > 0/);
  assert.match(policy, /Number\.isFinite\(value\) && value >= 0/);
});
