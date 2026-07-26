import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import coreWorker, {
  lightweightLiveBudgetKind,
  lightweightLiveCompleteBatch,
  runCoreFetch,
  runCoreQueue,
} from '../src/runtime-orchestrator-entry.js';

function batch(queue, body = {}) {
  return { queue, messages: [{ body }] };
}

function liveCompleteBody(jobKind = 'live') {
  return {
    message_type: 'minute-fact-derive-stage',
    message_version: 1,
    stage: 'complete',
    job: { id: 42, job_kind: jobKind },
  };
}

const LIVE_ENV = Object.freeze({
  LIVE_REVISION_MATERIALIZATION_ENABLED: false,
  HISTORICAL_REBUILD_ENABLED: true,
});

test('core Worker exposes only fetch and queue surfaces', () => {
  assert.deepEqual(Object.keys(coreWorker).sort(), ['fetch', 'queue']);
});

test('core queue keeps only active runtime routes', async () => {
  const calls = [];
  const dependencies = {
    runEnrichmentQueue: async () => calls.push('enrichment'),
    runRuntimeQueue: async () => calls.push('runtime'),
  };

  await runCoreQueue(batch('stationhead-minute-enrichment'), {}, {}, dependencies);
  await runCoreQueue(batch('stationhead-minute-derive'), {}, {}, dependencies);

  assert.deepEqual(calls, ['enrichment', 'runtime']);
});

test('all budgeted live stages bypass the common runtime and derive graphs', async () => {
  const cases = [
    ['trigger', { message_type: 'minute-fact-derive', message_version: 1 }],
    ['revision', {
      message_type: 'minute-fact-derive-stage',
      message_version: 1,
      stage: 'revision-materialize',
      revision: { revision_id: 7, sparse: true, rebuild: false },
    }],
    ['write', {
      message_type: 'minute-fact-derive-stage',
      message_version: 1,
      stage: 'budget-live-write',
      job: { id: 42, job_kind: 'live' },
    }],
    ['complete', liveCompleteBody()],
  ];
  for (const [kind, body] of cases) {
    assert.equal(
      lightweightLiveBudgetKind(batch('stationhead-minute-live-derive', body), LIVE_ENV),
      kind,
    );
  }
  assert.equal(lightweightLiveCompleteBatch(
    batch('stationhead-minute-live-derive', liveCompleteBody()),
    LIVE_ENV,
  ), true);
  assert.equal(lightweightLiveBudgetKind(
    batch('stationhead-minute-live-derive', liveCompleteBody('rebuild')),
    LIVE_ENV,
  ), null);

  const calls = [];
  const handlers = {
    async runLiveTriggerQueue() { calls.push('trigger'); },
    async runLiveRevisionQueue() { calls.push('revision'); },
    async runLiveWriteQueue() { calls.push('write'); },
    async runLiveCompleteQueue() { calls.push('complete'); },
    async runRuntimeQueue() { calls.push('runtime'); },
  };
  for (const [_kind, body] of cases) {
    await runCoreQueue(batch('stationhead-minute-live-derive', body), LIVE_ENV, {}, handlers);
  }
  assert.deepEqual(calls, ['trigger', 'revision', 'write', 'complete']);
});

test('internal Pages fetch remains delegated to the serving adapter', async () => {
  const response = await runCoreFetch(new Request('https://internal.test/'), {}, {}, {
    runPagesFetch: async () => new Response('ok'),
  });
  assert.equal(await response.text(), 'ok');
});

test('runtime, collector, and recovery configs preserve domain isolation', () => {
  const collector = JSON.parse(readFileSync(
    new URL('../wrangler.buddies-collector.jsonc', import.meta.url),
    'utf8',
  ));
  const recovery = JSON.parse(readFileSync(
    new URL('../wrangler.buddies-recovery.jsonc', import.meta.url),
    'utf8',
  ));
  const runtime = JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const pagesConfig = JSON.parse(readFileSync(new URL('../../site/wrangler.jsonc', import.meta.url), 'utf8'));
  const workers = readFileSync(new URL('../scripts/cloudflare-workers.mjs', import.meta.url), 'utf8');
  const collectorConsumers = new Set(collector.queues.consumers.map(({ queue }) => queue));
  const recoveryConsumers = new Set(recovery.queues.consumers.map(({ queue }) => queue));
  const runtimeConsumers = new Set(runtime.queues.consumers.map(({ queue }) => queue));

  for (const queue of ['stationhead-raw-collection', 'stationhead-comments', 'stationhead-buddies-persist']) {
    assert.equal(recoveryConsumers.has(queue), true, queue);
    assert.equal(collectorConsumers.has(queue), false, queue);
    assert.equal(runtimeConsumers.has(queue), false, queue);
  }
  for (const queue of [
    'stationhead-minute-enrichment',
    'stationhead-track-metadata',
    'stationhead-minute-live-derive',
  ]) {
    assert.equal(runtimeConsumers.has(queue), true, queue);
    assert.equal(collectorConsumers.has(queue), false, queue);
    assert.equal(recoveryConsumers.has(queue), false, queue);
  }
  for (const retiredQueue of [
    'stationhead-pages-read-model-publication',
    'stationhead-read-model',
    'stationhead-host-monitor',
  ]) {
    assert.equal(runtimeConsumers.has(retiredQueue), false, retiredQueue);
  }
  assert.equal(runtime.triggers, undefined);
  assert.equal(runtime.durable_objects, undefined);
  assert.equal(packageJson.scripts['deploy:buddies-recovery'], 'node scripts/deploy-buddies-recovery.mjs');
  assert.equal(packageJson.scripts['deploy:buddies-collector'], 'node scripts/deploy-buddies-collector.mjs');
  assert.equal(packageJson.scripts['deploy:runtime'], 'node scripts/deploy-runtime.mjs');
  assert.deepEqual(pagesConfig.services, [{
    binding: 'PAGES_READ_MODEL_SERVICE',
    service: 'sh-runtime-orchestrator',
  }]);
  const activeBlock = workers.slice(
    workers.indexOf('ACTIVE_WORKER_NAMES'),
    workers.indexOf('RETIRED_WORKER_NAMES'),
  );
  assert.deepEqual(
    [...activeBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]),
    ['sh-sakurazaka46jp', 'sh-buddies-recovery', 'sh-buddies-collector', 'sh-runtime-orchestrator'],
  );
});
