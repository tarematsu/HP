import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_data_acquisition_resource_policy_fix.h', import.meta.url),
  'utf8',
);

test('streakStats is protected before optional request blocking', () => {
  const protectedAt = policy.indexOf('StationheadDataAcquisitionRequestBoundaryFixed(lower)');
  const blockingAt = policy.indexOf('StationheadRequestIsBlockableBoundaryFixed(lower)', protectedAt);
  assert.ok(protectedAt >= 0);
  assert.ok(blockingAt > protectedAt);
  assert.match(policy, /\/me\/channel\/318\/streakstats/);
  assert.match(policy, /if \(!protectedData\) \{/);
});
