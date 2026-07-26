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

test('Actions cadence replaces the former six-hour minute-slot dispatcher', () => {
  assert.deepEqual([...dueVariantKeys(BASE + 4 * MINUTE_MS)], [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:broadcasts',
    'history:monthly',
    'host-history:summary',
    'track-history',
  ]);
  assert.deepEqual([...dueVariantKeys(BASE + 19 * MINUTE_MS)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(BASE + 64 * MINUTE_MS)], ['dashboard', 'history:daily']);
  assert.deepEqual([...dueVariantKeys(BASE + 184 * MINUTE_MS)], [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:broadcasts',
  ]);
});

test('one Actions process advances track-history until publication and then renders due variants', async () => {
  const calls = [];
  const result = await runPagesReadModelActions({
    startedAt: BASE + 19 * MINUTE_MS,
    deadlineMs: BASE + 30 * MINUTE_MS,
    now: () => BASE + 19 * MINUTE_MS,
    maxSteps: 3,
    env: { DB: {}, BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: {} },
    runTrackHistoryStep: async () => {
      calls.push('track');
      const published = calls.length === 3;
      return {
        task: { kind: published ? 'track-history-published' : 'track-history-publish-step' },
        stage: { published },
        publication: { published, phase: published ? 'published' : 'rows' },
      };
    },
    materializeVariant: async (variant) => {
      calls.push(variant.key);
      return { key: variant.key };
    },
  });

  assert.equal(result.track_history_steps, 3);
  assert.deepEqual(calls, ['track', 'track', 'track', 'dashboard', 'track-history']);
});

test('track-history shard primitive still rejects only the final idle minutes before reading env', async () => {
  const env = new Proxy({}, {
    get() { assert.fail('inactive track-history minute must not inspect the environment'); },
  });
  const result = await runTrackHistoryCycleStep(env, BASE + TRACK_HISTORY_ACTIVE_MINUTES * MINUTE_MS);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'track-history-cycle-idle');
  assert.equal(result.task.cycle_minute, TRACK_HISTORY_ACTIVE_MINUTES);
});
