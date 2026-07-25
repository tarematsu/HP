import assert from 'node:assert/strict';
import test from 'node:test';

import { runMinuteMaintenanceSyncInline } from '../src/minute-maintenance-optimized-entry.js';
import { recordMinuteFactRuntimeState } from '../src/minute-facts-runtime-state.js';
import { processMinuteRebuildBatch } from '../src/minute-rebuild-batched-entry.js';
import { throwIfSoftFailure } from '../src/soft-failure.js';

const SYNC_CRON = '5,7,9,15,17,19,25,27,29,35,37,39,45,47,49,55,57,59 * * * *';
const SCHEDULED_AT = Date.UTC(2026, 0, 1, 0, 9, 0);

function queueMessage(body, events) {
  return {
    body,
    ack() { events.push('ack'); },
    retry(options) { events.push(`retry:${options?.delaySeconds ?? 0}`); },
  };
}

test('soft failure details are redacted before becoming thrown diagnostics', () => {
  assert.throws(
    () => throwIfSoftFailure({
      result: {
        failed: true,
        error: 'request failed with Bearer secret-token-value',
      },
    }, 'minute maintenance'),
    /Bearer \[redacted\]/,
  );
});

test('inline sync rejects a returned soft failure so runtime fallback can enqueue it', async () => {
  await assert.rejects(
    runMinuteMaintenanceSyncInline(
      { cron: SYNC_CRON, scheduledTime: SCHEDULED_AT },
      {},
      null,
      {
        maintenance: {},
        async processMinuteMaintenanceSync() {
          return {
            stage: 'maintenance-run',
            task: 'sync',
            result: { failed: true, error: 'D1 sync temporarily unavailable' },
          };
        },
      },
    ),
    /D1 sync temporarily unavailable/,
  );
});

test('queued sync retries instead of acknowledging a returned soft failure', async () => {
  const events = [];
  const message = queueMessage({
    message_type: 'minute-rebuild-stage',
    message_version: 1,
    stage: 'maintenance-run',
    maintenance_task: 'sync',
  }, events);
  const originalError = console.error;
  console.error = () => {};
  try {
    await processMinuteRebuildBatch({ messages: [message] }, {}, null, {
      async processMinuteMaintenanceSync() {
        return {
          stage: 'maintenance-run',
          task: 'sync',
          result: { failed: true, error: 'metadata copy failed' },
        };
      },
    });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(events, ['retry:60']);
});

test('failed=true is persisted as a failed runtime heartbeat even without an error string', async () => {
  let bound = null;
  const env = {
    MINUTE_DB: {
      prepare() {
        return {
          bind(...params) {
            bound = params;
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };
  const result = await recordMinuteFactRuntimeState(
    env,
    'sync',
    { failed: true },
    { now: 2_000, startedAt: 1_000 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unknown failure');
  assert.equal(bound[5], 'unknown failure');
  assert.equal(bound[7], 0);
  assert.equal(bound[8], 1);
});
