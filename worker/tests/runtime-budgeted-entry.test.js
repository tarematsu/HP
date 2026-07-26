import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { queueAttributedEnv } from '../src/queue-attribution.js';

function runtimeConfig() {
  return JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));
}

test('all downstream Queue sends carry producer and operation attribution', async () => {
  const sent = [];
  const env = queueAttributedEnv({
    MINUTE_DERIVE_QUEUE: {
      async send(body, options) { sent.push({ body, options }); },
    },
  }, 'sh-runtime-orchestrator');
  await env.MINUTE_DERIVE_QUEUE.send(
    { message_type: 'minute-fact-derive', message_version: 1 },
    { contentType: 'json' },
  );
  assert.deepEqual(sent[0].body, {
    message_type: 'minute-fact-derive',
    message_version: 1,
    producer_worker: 'sh-runtime-orchestrator',
    operation_name: 'minute-derive',
  });
});

test('runtime is queue-only and retains bounded realtime consumers', () => {
  const config = runtimeConfig();
  assert.equal(config.main, 'src/runtime-orchestrator-deployed-entry.js');
  assert.equal(config.triggers, undefined);
  assert.equal(config.durable_objects, undefined);
  assert.equal(config.observability.head_sampling_rate, 0.1);
  assert.equal(config.observability.logs.head_sampling_rate, 0.1);

  const consumers = new Map(config.queues.consumers.map((consumer) => [consumer.queue, consumer]));
  assert.deepEqual([...consumers.keys()], [
    'stationhead-minute-enrichment',
    'stationhead-track-metadata',
    'stationhead-minute-derive',
    'stationhead-minute-live-derive',
    'stationhead-buddies-facts',
    'stationhead-minute-rebuild',
  ]);
  for (const [queue, consumer] of consumers) {
    assert.equal(consumer.max_batch_size, 1, queue);
    assert.equal(consumer.max_retries <= 4, true, queue);
  }

  assert.equal(consumers.has('stationhead-host-monitor'), false);
  assert.equal(consumers.has('stationhead-read-model'), false);
  assert.equal(consumers.has('stationhead-pages-read-model-publication'), false);
});
