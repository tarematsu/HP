import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TRACK_HISTORY_ACTIVE_MINUTES,
  runTrackHistoryCycleStep,
} from '../src/pages-track-history-cycle.js';

const MINUTE_MS = 60_000;
const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

test('track-history shard primitive remains available for explicit maintenance only', async () => {
  const env = new Proxy({}, {
    get() { assert.fail('inactive track-history minute must not inspect the environment'); },
  });
  const result = await runTrackHistoryCycleStep(env, BASE + TRACK_HISTORY_ACTIVE_MINUTES * MINUTE_MS);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'track-history-cycle-idle');
  assert.equal(result.task.cycle_minute, TRACK_HISTORY_ACTIVE_MINUTES);
});
