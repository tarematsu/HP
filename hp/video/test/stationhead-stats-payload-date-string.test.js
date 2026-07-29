import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('stats normalizer accepts ISO date timestamps through Date.parse', () => {
  assert.match(policy, /Date\.parse\(String\(rawTimestamp \|\| ''\)\)/);
});
