import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runMinuteFactsGapScanActions } from '../scripts/run-minute-facts-gap-scan-actions.mjs';

const runner = readFileSync(
  new URL('../scripts/run-minute-facts-gap-scan-actions.mjs', import.meta.url),
  'utf8',
);

test('Actions gap scan defaults to one repair job and a four-hour cadence', () => {
  assert.match(runner, /GAP_SCAN_MAX_JOBS: process\.env\.GAP_SCAN_MAX_JOBS \|\| '1'/);
  assert.match(runner, /DEFAULT_GAP_SCAN_MIN_INTERVAL_MS = 4 \* 60 \* 60_000/);
});

test('recent completed gap scan skips historical source reads', async () => {
  const now = 20 * 60 * 60_000;
  let stateReads = 0;
  const result = await runMinuteFactsGapScanActions({
    now: () => now,
    env: {
      DB: {
        prepare() {
          assert.fail('source database must not be read during cadence skip');
        },
      },
      MINUTE_DB: {},
      GAP_SCAN_MAX_JOBS: '1',
    },
    loadState: async () => {
      stateReads += 1;
      return {
        last_to: now - 5 * 60_000,
        updated_at: now - 60 * 60_000,
      };
    },
  });

  assert.equal(stateReads, 1);
  assert.deepEqual(result, {
    event: 'minute_fact_gap_scan_summary',
    skipped: true,
    reason: 'gap-scan-cadence',
    last_to: now - 5 * 60_000,
    last_scan_at: now - 60 * 60_000,
    min_interval_ms: 4 * 60 * 60_000,
  });
});
