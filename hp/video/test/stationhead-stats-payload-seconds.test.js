import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('second-based timestamps are promoted to milliseconds', () => {
  assert.match(policy, /timestamp > 0 && timestamp < 10_000_000_000\) timestamp \*= 1000/);
});
