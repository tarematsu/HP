import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('invalid payload resets the page success throttle before reporting failure', () => {
  const invalidAt = policy.indexOf('if (!chartData.length)');
  const resetAt = policy.indexOf('resetSuccessThrottle();', invalidAt);
  const errorAt = policy.indexOf("error: 'invalid-payload:'", invalidAt);
  assert.ok(invalidAt >= 0 && resetAt > invalidAt && errorAt > resetAt);
});
