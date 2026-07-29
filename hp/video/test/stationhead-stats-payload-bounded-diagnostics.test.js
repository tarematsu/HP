import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('invalid payload diagnostics expose only bounded top-level key names', () => {
  assert.match(policy, /Object\.keys\(data\)\.slice\(0, 12\)\.join\(','\)/);
  assert.doesNotMatch(policy, /JSON\.stringify\(data\)/);
});
