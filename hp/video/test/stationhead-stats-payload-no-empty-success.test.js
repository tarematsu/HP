import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_stats_payload_policy_fix.h', import.meta.url),
  'utf8',
);

test('empty normalized charts produce an error rather than a stats message', () => {
  const invalidBlock = policy.slice(
    policy.indexOf('if (!chartData.length)'),
    policy.indexOf('window.__homepanelStationheadPlayStatsSuccessAt = Date.now();'),
  );
  assert.match(invalidBlock, /stationhead-play-stats-error/);
  assert.doesNotMatch(invalidBlock, /type: 'stationhead-play-stats'/);
});
