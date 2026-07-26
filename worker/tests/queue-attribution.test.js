import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { queueAttributedEnv } from '../src/queue-attribution.js';

test('Queue attribution covers single and batched sends without overwriting explicit metadata', async () => {
  const singles = [];
  const batches = [];
  const env = queueAttributedEnv({
    MINUTE_FACT_QUEUE: {
      async send(body, options) { singles.push({ body, options }); },
      async sendBatch(entries) { batches.push(entries); },
    },
  }, 'sh-buddies-collector');

  await env.MINUTE_FACT_QUEUE.send({ message_type: 'minute-fact' }, { contentType: 'json' });
  await env.MINUTE_FACT_QUEUE.sendBatch([
    { body: { message_type: 'minute-fact' }, contentType: 'json' },
    { body: { message_type: 'minute-fact', producer_worker: 'explicit' } },
  ]);

  assert.equal(singles[0].body.producer_worker, 'sh-buddies-collector');
  assert.equal(singles[0].body.operation_name, 'minute-fact');
  assert.equal(batches[0][0].body.producer_worker, 'sh-buddies-collector');
  assert.equal(batches[0][0].body.operation_name, 'minute-fact');
  assert.equal(batches[0][1].body.producer_worker, 'explicit');
});

test('all active Stationhead entries apply Queue attribution and sampled telemetry', () => {
  const collector = readFileSync(new URL('../src/buddies-collector-do-entry.js', import.meta.url), 'utf8');
  const recovery = readFileSync(new URL('../src/buddies-recovery-entry.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../src/runtime-orchestrator-deployed-entry.js', import.meta.url), 'utf8');
  const sakurazaka = readFileSync(new URL('../src/sakurazaka-entry.js', import.meta.url), 'utf8');
  for (const source of [collector, recovery, runtime, sakurazaka]) assert.match(source, /queueAttributedEnv/);
  assert.match(runtime, /'sh-runtime-orchestrator'/);
  assert.doesNotMatch(runtime, /scheduled\s*:/);

  const config = JSON.parse(readFileSync(
    new URL('../wrangler.sakurazaka46jp.jsonc', import.meta.url),
    'utf8',
  ));
  assert.equal(config.observability.head_sampling_rate, 1);
  assert.equal(config.observability.logs.head_sampling_rate, 1);
  assert.equal(config.queues.consumers[0].max_retries, 4);
});
