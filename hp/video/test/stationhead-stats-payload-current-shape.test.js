import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('current chart_data ts/val contract remains first priority', () => {
  assert.match(policy, /Array\.isArray\(data\?\.chart_data\) \? data\.chart_data/);
  assert.match(policy, /point\?\.ts \?\? point\?\.timestamp/);
  assert.match(policy, /point\?\.val \?\? point\?\.value/);
});
