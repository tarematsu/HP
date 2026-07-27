import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { processMinuteEnrichmentBatch } from '../src/minute-enrichment-optimized-entry.js';
import {
  LIVE_DERIVE_QUEUE_NAME,
  processMinutePipelineBatch,
} from '../src/minute-pipeline-entry.js';

function message(body) {
  const calls = { ack: 0, retry: [] };
  return {
    body,
    ack() { calls.ack += 1; },
    retry(options) { calls.retry.push(options); },
    calls,
  };
}

test('mixed minute derive batches route each message independently', async () => {
  const repair = message({
    message_type: 'minute-fact-derive',
    message_version: 1,
    job_kind: 'repair',
  });
  const live = message({
    message_type: 'minute-fact-derive',
    message_version: 1,
    job_kind: 'live',
  });
  const liveBodies = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    const result = await processMinutePipelineBatch({
      queue: LIVE_DERIVE_QUEUE_NAME,
      messages: [repair, live],
    }, {}, {}, {
      async processBudgetedLiveTriggerBatch(batch) {
        liveBodies.push(batch.messages[0].body);
        batch.messages[0].ack();
        return { processed: 'live' };
      },
    });

    assert.equal(result.event, 'minute_pipeline_batch_split_completed');
    assert.equal(result.messages, 2);
    assert.equal(repair.calls.ack, 1);
    assert.equal(live.calls.ack, 1);
    assert.deepEqual(repair.calls.retry, []);
    assert.deepEqual(live.calls.retry, []);
    assert.deepEqual(liveBodies, [live.body]);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
});

test('minute enrichment settles every message in a multi-message batch', async () => {
  const first = message({ stage: 'custom', id: 1 });
  const second = message({ stage: 'custom', id: 2 });
  const third = message({ stage: 'custom', id: 3 });
  const seen = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    const result = await processMinuteEnrichmentBatch({
      queue: 'stationhead-minute-enrichment',
      messages: [first, second, third],
    }, {}, {
      async processMinuteEnrichment(_env, body) {
        seen.push(body.id);
        if (body.id === 2) throw new Error('transient enrichment failure');
        return { minuteAt: body.id };
      },
    });

    assert.deepEqual(seen, [1, 2, 3]);
    assert.deepEqual(result, { messages: 3, acknowledged: 2, retried: 1 });
    assert.equal(first.calls.ack, 1);
    assert.equal(second.calls.ack, 0);
    assert.equal(third.calls.ack, 1);
    assert.deepEqual(first.calls.retry, []);
    assert.deepEqual(second.calls.retry, [{ delaySeconds: 30 }]);
    assert.deepEqual(third.calls.retry, []);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
});

test('production runtime consumers remain single-message for bounded CPU', () => {
  const config = JSON.parse(readFileSync(
    new URL('../wrangler.runtime.jsonc', import.meta.url),
    'utf8',
  ));
  assert.ok(config.queues.consumers.length > 0);
  for (const consumer of config.queues.consumers) {
    assert.equal(consumer.max_batch_size, 1, consumer.queue);
  }
});
