import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('sparse chart points are inspected without throwing', () => {
  assert.match(policy, /point\?\.ts/);
  assert.match(policy, /point\?\.val/);
});
