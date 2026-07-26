import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled,
} from '../src/buddies-collector-core.js';

const SCHEDULED_AT = Date.UTC(2026, 6, 26, 15, 20, 0);
const controller = { cron: BUDDIES_COLLECTOR_CRON, scheduledTime: SCHEDULED_AT };

test('successful buddies collection clears recorded failure before releasing its lease', async () => {
  const calls = [];
  const result = await runBuddiesCollectorScheduled(controller, {}, null, {
    now: () => SCHEDULED_AT + 100,
    holderId: 'holder-success',
    async claimPrimaryRunLock() {
      calls.push('claim');
      return true;
    },
    async collectRawChannel() {
      calls.push('collect');
      return { payload_bytes: 123 };
    },
    async clearCollectorFailure() {
      calls.push('clear');
      return true;
    },
    async releasePrimaryRunLock() {
      calls.push('release');
      return true;
    },
  });

  assert.deepEqual(calls, ['claim', 'collect', 'clear', 'release']);
  assert.equal(result.collected, true);
  assert.equal(result.payload_bytes, 123);
});

test('failed buddies collection records a sanitized diagnosis and preserves lease TTL behavior', async () => {
  const calls = [];
  let recorded = null;
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      runBuddiesCollectorScheduled(controller, {}, null, {
        now: () => SCHEDULED_AT + 100,
        holderId: 'holder-failure',
        async claimPrimaryRunLock() {
          calls.push('claim');
          return true;
        },
        async collectRawChannel() {
          calls.push('collect');
          throw new Error('request failed with Bearer secret-token-value');
        },
        async recordCollectorFailure(_env, error, stage, source, at) {
          calls.push('record');
          recorded = { error, stage, source, at };
          return {
            recorded: true,
            diagnosis: { code: 'NETWORK_ERROR', stage },
          };
        },
        async clearCollectorFailure() {
          calls.push('clear');
        },
        async releasePrimaryRunLock() {
          calls.push('release');
        },
      }),
      /secret-token-value/,
    );
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(calls, ['claim', 'collect', 'record']);
  assert.equal(recorded.stage, 'collector_unknown');
  assert.equal(recorded.source, 'cron');
  assert.equal(recorded.at, SCHEDULED_AT);
});
