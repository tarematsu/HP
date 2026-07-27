import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUDDIES_COLLECTOR_CRON,
  minuteLiveRecoveryDispatchDue,
  runBuddiesCollectorScheduled,
} from '../src/buddies-collector-core.js';

const SCHEDULED_AT = Date.UTC(2026, 6, 26, 15, 20, 0);
const controller = { cron: BUDDIES_COLLECTOR_CRON, scheduledTime: SCHEDULED_AT };

test('live minute recovery dispatch is due only once per five-minute window', () => {
  assert.equal(minuteLiveRecoveryDispatchDue(SCHEDULED_AT), true);
  assert.equal(minuteLiveRecoveryDispatchDue(SCHEDULED_AT + 60_000), false);
  assert.equal(minuteLiveRecoveryDispatchDue(SCHEDULED_AT + 4 * 60_000), false);
  assert.equal(minuteLiveRecoveryDispatchDue(SCHEDULED_AT + 5 * 60_000), true);
  assert.equal(minuteLiveRecoveryDispatchDue(Number.NaN), false);
});

test('successful buddies collection clears and releases before bounded live recovery', async () => {
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
    async dispatchPendingMinuteFacts(_env, dependencies) {
      calls.push('recover');
      assert.equal(dependencies.now, SCHEDULED_AT);
      return { dispatched: 2 };
    },
  });

  assert.deepEqual(calls, ['claim', 'collect', 'clear', 'release', 'recover']);
  assert.equal(result.collected, true);
  assert.equal(result.payload_bytes, 123);
  assert.deepEqual(result.minute_live_recovery, { dispatched: 2 });
});

test('successful collection skips recovery outside the five-minute boundary', async () => {
  const calls = [];
  const result = await runBuddiesCollectorScheduled({
    ...controller,
    scheduledTime: SCHEDULED_AT + 60_000,
  }, {}, null, {
    now: () => SCHEDULED_AT + 60_100,
    holderId: 'holder-no-recovery',
    async claimPrimaryRunLock() { return true; },
    async collectRawChannel() { return { payload_bytes: 1 }; },
    async clearCollectorFailure() {},
    async releasePrimaryRunLock() {},
    async dispatchPendingMinuteFacts() { calls.push('recover'); },
  });

  assert.deepEqual(calls, []);
  assert.equal(result.minute_live_recovery, undefined);
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
        async dispatchPendingMinuteFacts() {
          calls.push('recover');
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
