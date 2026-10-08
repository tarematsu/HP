import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HISTORY_READ_MODEL_RECOVERY_CRON,
  STATIONHEAD_LEADERBOARD_CRON,
  runScheduledCollectionJob,
} from '../src/scheduled-collection-jobs-entry.js';

const NOW = Date.UTC(2026, 9, 6, 12, 17);

test('leaderboard collection reconciles read-model revisions immediately after collection', async () => {
  const calls = [];
  const result = await runScheduledCollectionJob(
    { cron: STATIONHEAD_LEADERBOARD_CRON, scheduledTime: NOW },
    { marker: 'env' },
    {
      async refreshLeaderboard(env, message, now) {
        calls.push(['collect', env.marker, message, now]);
        return { status: 'published' };
      },
      async enqueueHistory(env, now) {
        calls.push(['enqueue', env.marker, now]);
        return { queued: 1, keys: ['weekly-ranking'] };
      },
    },
  );

  assert.deepEqual(calls, [
    ['collect', 'env', {}, NOW],
    ['enqueue', 'env', NOW],
  ]);
  assert.deepEqual(result.read_models, { queued: 1, keys: ['weekly-ranking'] });
});

test('minute history cron is recovery-only reconciliation', async () => {
  const calls = [];
  const result = await runScheduledCollectionJob(
    { cron: HISTORY_READ_MODEL_RECOVERY_CRON, scheduledTime: NOW },
    {},
    {
      async enqueueHistory(_env, now) {
        calls.push(now);
        return { queued: 0, keys: [] };
      },
    },
  );

  assert.deepEqual(calls, [NOW]);
  assert.deepEqual(result, { queued: 0, keys: [] });
});
