import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('normalization maps and filters without reordering chart points', () => {
  assert.match(policy, /\(rawChart \|\| \[\]\)\.map\(point => \{/);
  assert.doesNotMatch(policy, /\.sort\(/);
});
