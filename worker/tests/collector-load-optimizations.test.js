import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function config(path) {
  return JSON.parse(source(path));
}

test('inline collection records materialization state after structural changes', () => {
  const runner = source('../src/prepared-collector-runner.js');
  assert.match(runner, /import \{ recordQueueMaterialization \}/);
  assert.match(runner, /queueResult\?\.structure_changed === true/);
  assert.match(runner, /recordQueueMaterialization\(/);
  assert.match(runner, /materialization_state_written/);
});

test('snapshot analysis is computed only in persistence slots', () => {
  const collector = source('../src/raw-collector-entry.js');
  assert.match(collector, /function snapshotAnalysisDue/);
  assert.match(collector, /snapshotAnalysisDue\(env, base\.observed_at\)/);
  assert.match(collector, /payload_bytes/);
});

test('collector bundle excludes legacy recovery Queue dispatch', () => {
  const collectorCore = source('../src/buddies-collector-core.js');
  const recoveryCore = source('../src/buddies-recovery-core.js');
  assert.doesNotMatch(collectorCore, /runBuddiesRecoveryQueue|BUDDIES_RECOVERY_QUEUE_NAMES|ingestWorker/);
  assert.match(recoveryCore, /runBuddiesRecoveryQueue/);
  assert.match(recoveryCore, /BUDDIES_RECOVERY_QUEUE_NAMES/);
});

test('buddies Workers use low-frequency D1 checkpoints and metadata refresh', () => {
  for (const path of [
    '../wrangler.buddies-collector.jsonc',
    '../wrangler.buddies-recovery.jsonc',
  ]) {
    const worker = config(path);
    assert.equal(worker.vars.MINUTE_FACT_OUTBOX_RECONCILE_MS, 60 * 60_000, path);
    assert.equal(worker.vars.SNAPSHOT_PERSIST_INTERVAL_MS, 60 * 60_000, path);
    assert.equal(worker.vars.QUEUE_STABLE_CHECKPOINT_MINUTES, 60, path);
    assert.equal(worker.vars.METADATA_REFRESH_INTERVAL_MS, 24 * 60 * 60_000, path);
    assert.equal(worker.vars.COLLECTOR_D1_QUEUE_CURRENT_CACHE_MS, 60 * 60_000, path);
    assert.equal(worker.vars.COLLECTOR_D1_MATERIALIZATION_CACHE_MS, 5 * 60_000, path);
  }
});

test('recovery batches backlog and limits poison-message redelivery', () => {
  const recovery = config('../wrangler.buddies-recovery.jsonc');
  for (const consumer of recovery.queues.consumers) {
    assert.equal(consumer.max_batch_size, 10, consumer.queue);
    assert.equal(consumer.max_batch_timeout, 5, consumer.queue);
    assert.equal(consumer.max_retries, 4, consumer.queue);
    assert.equal(consumer.max_concurrency, 1, consumer.queue);
  }
});

test('collector and recovery use sampled invocation and application logs', () => {
  for (const path of [
    '../wrangler.buddies-collector.jsonc',
    '../wrangler.buddies-recovery.jsonc',
  ]) {
    const worker = config(path);
    assert.equal(worker.observability.head_sampling_rate, 0.1, path);
    assert.equal(worker.observability.logs.head_sampling_rate, 0.1, path);
    assert.equal(worker.observability.logs.invocation_logs, true, path);
  }
});
