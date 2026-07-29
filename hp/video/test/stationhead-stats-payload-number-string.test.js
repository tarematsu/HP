import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('stats normalizer converts scalar values with Number', () => {
  assert.match(policy, /const value = Number\(point\?\.val \?\? point\?\.value \?\? point\?\.count\);/);
});
