import assert from 'node:assert/strict';
import test from 'node:test';

import {
  processBudgetedLiveWriteBatch,
  processBudgetedLiveWriteMessage,
} from '../src/minute-live-write-budget-entry.js';

function validWriteBody() {
  return {
    message_type: 'minute-fact-derive-stage',
    message_version: 1,
    stage: 'write',
    job: { id: 42, job_kind: 'live', payload_version: 1 },
    payload: { payload_version: 1, snapshot: {}, queue: null },
    started_at: 100,
  };
}

function inlineCommitDependencies(overrides = {}) {
  return {
    materializer: {
      shouldMaterializeLiveRevision() { return false; },
    },
    writeThrottle: { withMinuteD1WriteThrottling: (env) => env },
    deriveQueue: {
      async processMinuteDeriveWriteStage(env, body, dependencies) {
        await dependencies.write(env, body.payload);
        return { pending: true };
      },
    },
    ...overrides,
  };
}

test('valid live writes commit inline when no revision is required', async () => {
  const saved = [];
  const sent = [];
  const result = await processBudgetedLiveWriteMessage({}, validWriteBody(), inlineCommitDependencies({
    fastStore: {
      async saveOptimizedMinuteFactWithinBudget(_env, payload) { saved.push(payload); },
    },
    async sendStage(body) { sent.push(body); },
  }));
  assert.deepEqual(result, { pending: true });
  assert.equal(saved.length, 1);
  assert.equal(sent.length, 0);
});

test('malformed live write messages are acknowledged instead of retried forever', async () => {
  const events = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    await processBudgetedLiveWriteBatch({
      messages: [{
        body: { ...validWriteBody(), job: {} },
        ack() { events.push('ack'); },
        retry() { events.push('retry'); },
      }],
    }, {});
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(events, ['ack']);
});

test('transient inline live write failures still retry with a bounded delay', async () => {
  const events = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    await processBudgetedLiveWriteBatch({
      messages: [{
        body: validWriteBody(),
        ack() { events.push('ack'); },
        retry(options) { events.push(['retry', options]); },
      }],
    }, {}, inlineCommitDependencies({
      fastStore: {
        async saveOptimizedMinuteFactWithinBudget() { throw new Error('D1 unavailable'); },
      },
    }));
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(events, [['retry', { delaySeconds: 60 }]]);
});
