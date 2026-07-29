import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('success timestamp is written only after normalized chart validation', () => {
  const normalizedAt = policy.indexOf("const chartData = (rawChart || []).map");
  const invalidAt = policy.indexOf('if (!chartData.length)');
  const successAt = policy.indexOf(
    'window.__homepanelStationheadPlayStatsSuccessAt = Date.now();',
  );
  assert.ok(normalizedAt >= 0 && normalizedAt < invalidAt && invalidAt < successAt);
});
