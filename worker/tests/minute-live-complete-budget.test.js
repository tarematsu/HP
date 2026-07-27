import assert from 'node:assert/strict';
import test from 'node:test';

import {
  budgetedLiveCompleteMessage,
  COMPLETE_LIVE_MINUTE_FACT_JOB_SQL,
  completeBudgetedLiveJob,
  processBudgetedLiveCompleteBatch,
} from '../src/minute-live-complete-budget-entry.js';
import {
  LIVE_DERIVE_QUEUE_NAME,
  processMinutePipelineBatch,
} from '../src/minute-pipeline-entry.js';

function body(jobKind = 'live') {
  return {
    message_type: 'minute-fact-derive-stage',
    message_version: 1,
    stage: 'complete',
    job: { id: 42, job_kind: jobKind },
    started_at: 100,
  };
}

function message(value, events) {
  return {
    body: value,
    ack() { events.push('ack'); },
    retry(options) { events.push(['retry', options]); },
  };
}

test('live completion validator rejects rebuild and malformed messages', () => {
  assert.equal(budgetedLiveCompleteMessage(body()), true);
  assert.equal(budgetedLiveCompleteMessage({ ...body(), job: { id: 42 } }), true);
  assert.equal(budgetedLiveCompleteMessage(body('rebuild')), false);
  assert.equal(budgetedLiveCompleteMessage({ ...body(), job: {} }), false);
  assert.equal(budgetedLiveCompleteMessage({ ...body(), job: { id: 0 } }), false);
  assert.equal(budgetedLiveCompleteMessage({ ...body(), stage: 'write' }), false);
});

test('live completion accepts both DO-claimed pending rows and legacy D1 processing rows', () => {
  assert.match(COMPLETE_LIVE_MINUTE_FACT_JOB_SQL, /status IN \('pending','processing'\)/);
  assert.doesNotMatch(COMPLETE_LIVE_MINUTE_FACT_JOB_SQL, /status='processing'$/);
});

test('live completion performs only the bounded job completion update', async () => {
  const calls = [];
  const statement = {
    bind(...values) { calls.push(['bind', values]); return this; },
    async run() { calls.push(['run']); return { meta: { changes: 1 } }; },
  };
  const result = await completeBudgetedLiveJob({
    MINUTE_DB: {
      prepare(sql) {
        calls.push(['sql', sql]);
        return statement;
      },
    },
  }, body(), { now: () => 500 });

  assert.equal(result.meta.changes, 1);
  assert.match(calls[0][1], /UPDATE sh_minute_fact_jobs/);
  assert.match(calls[0][1], /payload_clearable=0/);
  assert.match(calls[0][1], /status IN \('pending','processing'\)/);
  assert.doesNotMatch(calls[0][1], /sh_queue_revisions/);
  assert.deepEqual(calls[1], ['bind', [500, 500, 42]]);
  assert.deepEqual(calls[2], ['run']);
});

test('live completion batch acknowledges success and retries transient failures', async () => {
  const successful = [];
  await processBudgetedLiveCompleteBatch({ messages: [message(body(), successful)] }, {}, {
    async complete(_env, jobId, now) {
      assert.equal(jobId, 42);
      assert.equal(now, 700);
    },
    now: () => 700,
  });
  assert.deepEqual(successful, ['ack']);

  const failed = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    await processBudgetedLiveCompleteBatch({ messages: [message(body(), failed)] }, {}, {
      async complete() { throw new Error('D1 unavailable'); },
    });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(failed, [['retry', { delaySeconds: 60 }]]);
});

test('malformed live completion messages are acknowledged without a retry loop', async () => {
  const events = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    await processBudgetedLiveCompleteBatch({
      messages: [message({ ...body(), job: {} }, events)],
    }, {});
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(events, ['ack']);
});

test('live completion stays lightweight while rebuild completion is retired', async () => {
  const calls = [];
  await processMinutePipelineBatch({
    queue: LIVE_DERIVE_QUEUE_NAME,
    messages: [{ body: body() }],
  }, { LIVE_REVISION_MATERIALIZATION_ENABLED: false }, {}, {
    async processBudgetedLiveCompleteBatch(_batch, _env, dependencies) {
      calls.push(['live-complete', dependencies]);
    },
    liveComplete: { marker: true },
    async processMinuteDeriveBatch() {
      calls.push(['unexpected-full-derive']);
    },
  });
  assert.deepEqual(calls, [['live-complete', { marker: true }]]);

  const events = [];
  const result = await processMinutePipelineBatch({
    queue: LIVE_DERIVE_QUEUE_NAME,
    messages: [message(body('rebuild'), events)],
  }, { LIVE_REVISION_MATERIALIZATION_ENABLED: false }, {}, {
    async processBudgetedLiveCompleteBatch() {
      calls.push(['unexpected-lightweight']);
    },
    async processMinuteDeriveBatch() {
      calls.push(['unexpected-full-derive']);
    },
  });
  assert.equal(result.reason, 'rebuild-actions-owned');
  assert.deepEqual(events, ['ack']);
  assert.deepEqual(calls, [['live-complete', { marker: true }]]);
});
