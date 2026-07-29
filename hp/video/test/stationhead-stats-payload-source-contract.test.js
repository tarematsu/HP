import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('normalized payloads are identifiable without exposing authorization', () => {
  assert.match(policy, /source: 'authenticated-api-normalized'/);
  assert.doesNotMatch(policy, /post\([^\n]*authorization/);
});
