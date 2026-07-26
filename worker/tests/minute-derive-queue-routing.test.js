import assert from 'node:assert/strict';
import test from 'node:test';

import { enqueueMinuteDeriveTrigger } from '../src/minute-derive-trigger.js';
import {
  LIVE_DERIVE_QUEUE_NAME,
  processMinutePipelineBatch,
} from '../src/minute-pipeline-entry.js';
import { lightweightLiveBudgetKind } from '../src/runtime-orchestrator-entry.js';

function input(jobKind) {
  return {
    channel_id: 42,
    minute_at: 1_700_000_000_000,
    job_kind: jobKind,
  };
}

function trigger(jobKind) {
  return {
    message_type: 'minute-fact-derive',
    message_version: 1,
    job_id: 'minute-fact:42:1700000000000',
    ...input(jobKind),
  };
}

test('derive trigger enqueue publishes only live work', async () => {
  const sent = [];
  const env = {
    MINUTE_LIVE_DERIVE_QUEUE: {
      async send(body, options) { sent.push([body, options]); },
    },
    MINUTE_DERIVE_QUEUE: {
      async send() { throw new Error('ordered drain Queue must not receive new work'); },
    },
  };

  const live = await enqueueMinuteDeriveTrigger(env, input('live'));
  assert.equal(live.job_kind, 'live');
  assert.deepEqual(sent, [[live, { contentType: 'json' }]]);

  for (const jobKind of ['rebuild', 'repair']) {
    await assert.rejects(
      enqueueMinuteDeriveTrigger(env, input(jobKind)),
      (error) => error?.code === 'MINUTE_DERIVE_OFFLINE_WORK_RETIRED',
    );
  }
  assert.equal(sent.length, 1);
});

test('live enqueue does not fall back to the ordered drain Queue', async () => {
  let orderedSends = 0;
  await assert.rejects(
    enqueueMinuteDeriveTrigger({
      MINUTE_DERIVE_QUEUE: { async send() { orderedSends += 1; } },
    }, input('live')),
    /minute live derive Queue binding is missing/,
  );
  assert.equal(orderedSends, 0);
});

test('rebuild triggers are excluded from the lightweight live classifier', () => {
  const batch = { queue: LIVE_DERIVE_QUEUE_NAME, messages: [{ body: trigger('rebuild') }] };
  assert.equal(lightweightLiveBudgetKind(batch, {
    LIVE_REVISION_MATERIALIZATION_ENABLED: false,
  }), null);
});

test('stale rebuild triggers on the live Queue are always retired', async () => {
  for (const historicalFlag of [false, true]) {
    const events = [];
    const result = await processMinutePipelineBatch({
      queue: LIVE_DERIVE_QUEUE_NAME,
      messages: [{
        body: trigger('rebuild'),
        ack() { events.push('ack'); },
      }],
    }, { HISTORICAL_REBUILD_ENABLED: historicalFlag }, {}, {
      async processMinuteDeriveBatch() { events.push('unexpected-derive'); },
    });
    assert.equal(result.reason, 'rebuild-actions-owned');
    assert.deepEqual(events, ['ack']);
  }
});
