import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function config(path) {
  return JSON.parse(source(path));
}

const INGEST_QUEUES = Object.freeze([
  'stationhead-raw-collection',
  'stationhead-ingest-finalize',
  'stationhead-buddies-persist',
]);

test('collector owns the scheduled collection surface and recovery owns ingest Queue lanes', () => {
  const collector = config('../wrangler.buddies-collector.jsonc');
  const recovery = config('../wrangler.buddies-recovery.jsonc');
  const runtime = config('../wrangler.runtime.jsonc');
  const collectorEntry = source('../src/buddies-collector-entry.js');
  const recoveryEntry = source('../src/buddies-recovery-entry.js');

  assert.equal(collector.main, 'src/buddies-collector-entry.js');
  assert.equal(recovery.main, 'src/buddies-recovery-entry.js');
  assert.deepEqual(collector.queues.consumers, []);
  assert.equal(
    collector.queues.producers.find(({ binding }) => binding === 'RAW_COLLECTION_QUEUE').queue,
    'stationhead-raw-collection',
  );
  assert.equal(collector.queues.producers.some(({ queue }) => queue === 'stationhead-comments'), false);
  assert.equal(runtime.queues.producers.some(({ binding }) => binding === 'RAW_COLLECTION_QUEUE'), false);
  assert.equal(Object.hasOwn(runtime.vars, 'RAW_COLLECTION_ENABLED'), false);
  assert.equal(runtime.triggers, undefined);
  assert.match(collectorEntry, /runBuddiesCollectorScheduled/);
  assert.doesNotMatch(collectorEntry, /\bfetch\s*:/);
  assert.match(recoveryEntry, /runBuddiesRecoveryQueue/);
});

test('recovery Worker batches Queue delivery around one-message ingest dispatch', () => {
  const collector = config('../wrangler.buddies-collector.jsonc');
  const recovery = config('../wrangler.buddies-recovery.jsonc');
  const runtime = config('../wrangler.runtime.jsonc');
  const entry = source('../src/ingest-channel-optimized-entry.js');
  const recoveryCore = source('../src/buddies-recovery-core.js');
  const recoveryConsumers = new Map(
    recovery.queues.consumers.map((consumer) => [consumer.queue, consumer]),
  );
  const collectorConsumers = new Set(collector.queues.consumers.map(({ queue }) => queue));
  const runtimeConsumers = new Set(runtime.queues.consumers.map(({ queue }) => queue));
  for (const queue of INGEST_QUEUES) {
    assert.equal(recoveryConsumers.get(queue).max_batch_size, 10, queue);
    assert.equal(recoveryConsumers.get(queue).max_batch_timeout, 5, queue);
    assert.equal(collectorConsumers.has(queue), false, queue);
    assert.equal(runtimeConsumers.has(queue), false, queue);
  }
  assert.equal(recoveryConsumers.has('stationhead-comments'), false);
  assert.match(recoveryCore, /for \(const sourceMessage of messages\)/);
  assert.match(entry, /const message = messages\[0\]/);
  assert.match(entry, /switch \(type\)/);
  assert.match(entry, /const EMPTY_DEPENDENCIES = Object\.freeze/);
  assert.doesNotMatch(entry, /fetch\s*\(/);
});

test('persist remains the lazy sequential recovery lane and comments Queue is detached', () => {
  const recovery = config('../wrangler.buddies-recovery.jsonc');
  const entry = source('../src/ingest-channel-optimized-entry.js');
  const consumers = new Map(recovery.queues.consumers.map((consumer) => [consumer.queue, consumer]));
  const persist = consumers.get('stationhead-buddies-persist');
  assert.equal(persist.max_batch_size, 10);
  assert.equal(persist.max_batch_timeout, 5);
  assert.equal(persist.max_concurrency, 1);
  assert.equal(consumers.has('stationhead-comments'), false);
  assert.match(entry, /persistModulePromise/);
});
