import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dueVariantKeys,
  runPagesReadModelActions,
} from '../scripts/run-pages-read-model-actions.mjs';
import {
  TRACK_HISTORY_ACTIVE_MINUTES,
  runTrackHistoryCycleStep,
} from '../src/pages-track-history-cycle.js';

const MINUTE_MS = 60_000;
const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

const ALL_VARIANTS = [
  'dashboard',
  'history:daily',
  'history:weekly',
  'history:monthly',
  'history:broadcasts',
  'host-history:summary',
];

const SIX_HOUR_VARIANTS = ALL_VARIANTS.slice(0, -1);

test('Actions cadence uses six-hour summaries and daily host archive variants', () => {
  assert.deepEqual([...dueVariantKeys(BASE + 26 * MINUTE_MS)], ALL_VARIANTS);
  assert.deepEqual([...dueVariantKeys(BASE + 55 * MINUTE_MS)], ALL_VARIANTS);
  assert.deepEqual([...dueVariantKeys(BASE + 56 * MINUTE_MS)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(BASE + 86 * MINUTE_MS)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(BASE + 386 * MINUTE_MS)], SIX_HOUR_VARIANTS);
});

test('one Actions process publishes due variants without advancing track-history', async () => {
  const calls = [];
  let trackCalls = 0;
  const result = await runPagesReadModelActions({
    startedAt: BASE + 19 * MINUTE_MS,
    deadlineMs: BASE + 30 * MINUTE_MS,
    now: () => BASE + 19 * MINUTE_MS,
    env: { DB: {}, BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: {} },
    runTrackHistoryStep: async () => { trackCalls += 1; },
    materializeVariant: async (variant) => {
      calls.push(variant.key);
      return { key: variant.key };
    },
  });

  assert.equal(trackCalls, 0);
  assert.equal(result.track_history_steps, 0);
  assert.equal(result.track_history_result.reason, 'track-history-read-model-disabled');
  assert.deepEqual(calls, ['dashboard']);
});

test('track-history shard primitive remains available for explicit maintenance only', async () => {
  const env = new Proxy({}, {
    get() { assert.fail('inactive track-history minute must not inspect the environment'); },
  });
  const result = await runTrackHistoryCycleStep(env, BASE + TRACK_HISTORY_ACTIVE_MINUTES * MINUTE_MS);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'track-history-cycle-idle');
  assert.equal(result.task.cycle_minute, TRACK_HISTORY_ACTIVE_MINUTES);
});
