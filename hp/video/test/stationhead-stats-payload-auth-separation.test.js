import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('payload validation does not mutate auth caches', () => {
  assert.doesNotMatch(policy, /LastAcceptedAuthHeaders\s*=/);
  assert.doesNotMatch(policy, /AuthHeaders\s*=\s*null/);
});
