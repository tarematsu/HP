import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RUNTIME_CRON,
  RUNTIME_MINUTE_RECOVERY_MESSAGE,
  minuteRecoveryPollDue,
  runRuntimeScheduled,
} from '../src/runtime-scheduled.js';

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

test('runtime Cron relays minute recovery without inline D1 work', async () => {
  const hostBatches = [];
  const recoveryCalls = [];
  const scheduledAt = BASE + 31 * 60_000;
  const ctx = { waitUntil() {} };
  const env = {
    HOST_MONITOR_QUEUE: {
      async sendBatch(messages) {
        hostBatches.push(messages);
      },
    },
  };

  const result = await runRuntimeScheduled(
    { cron: RUNTIME_CRON, scheduledTime: scheduledAt },
    env,
    ctx,
    {
      async dispatchRawCollection() {},
      async dispatchPendingMinuteFacts(activeEnv, dependencies, activeCtx) {
        recoveryCalls.push({ activeEnv, dependencies, activeCtx });
        return { dispatched: 0 };
      },
      minuteDispatchDependencies: { marker: 'recovery' },
    },
  );

  assert.deepEqual(recoveryCalls, []);
  assert.deepEqual(hostBatches.flat().map(({ body }) => body), [{
    message_type: RUNTIME_MINUTE_RECOVERY_MESSAGE,
    message_version: 1,
    scheduled_at: scheduledAt,
  }]);
  assert.deepEqual(result.map(({ task }) => task), ['raw-collection', 'minute-recovery']);
});

test('minute recovery polling runs once per fifteen-minute window', () => {
  for (const minute of [1, 16, 31, 46]) {
    assert.equal(minuteRecoveryPollDue(BASE + minute * 60_000), true);
  }
  for (const minute of [0, 5, 6, 11, 15, 21, 30, 36, 45, 51, 59]) {
    assert.equal(minuteRecoveryPollDue(BASE + minute * 60_000), false);
  }
});
