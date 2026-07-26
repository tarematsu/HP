import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  recoveryRetryDelaySeconds,
  runBuddiesRecoveryQueue,
} from '../src/buddies-recovery-core.js';

test('recovery retry backoff is bounded', () => {
  assert.equal(recoveryRetryDelaySeconds(1), 5);
  assert.equal(recoveryRetryDelaySeconds(2), 10);
  assert.equal(recoveryRetryDelaySeconds(4), 40);
  assert.equal(recoveryRetryDelaySeconds(99), 300);
  assert.equal(recoveryRetryDelaySeconds(undefined), 5);
});

test('unsettled recovery messages retry with attempt-aware delay', async () => {
  let retryOptions;
  const summary = await runBuddiesRecoveryQueue({
    queue: 'stationhead-raw-collection',
    messages: [{
      attempts: 3,
      body: { message_type: 'raw-collection' },
      timestamp: new Date(1_000),
      ack() {},
      retry(options) { retryOptions = options; },
    }],
  }, {}, {}, {
    now: (() => {
      const values = [10_000, 10_010];
      return () => values.shift() ?? 10_010;
    })(),
    async runIngestQueue() {},
    async recordTelemetry() {},
  });

  assert.deepEqual(retryOptions, { delaySeconds: 20 });
  assert.equal(summary.retried, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.max_attempts, 3);
});

test('recovery scales catch-up lanes while preserving sequential write lanes', () => {
  const config = JSON.parse(readFileSync(
    new URL('../wrangler.buddies-recovery.jsonc', import.meta.url),
    'utf8',
  ));
  const consumers = new Map(config.queues.consumers.map((consumer) => [consumer.queue, consumer]));

  assert.equal(consumers.size, 4);
  assert.equal(consumers.get('stationhead-raw-collection').max_concurrency, 4);
  assert.equal(consumers.get('stationhead-ingest-finalize').max_concurrency, 4);
  assert.equal(consumers.get('stationhead-comments').max_concurrency, 1);
  assert.equal(consumers.get('stationhead-buddies-persist').max_concurrency, 1);

  for (const consumer of consumers.values()) {
    assert.equal(consumer.max_retries, 4);
    assert.equal(typeof consumer.dead_letter_queue, 'string');
  }
});
