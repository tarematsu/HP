import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function config(path) {
  return JSON.parse(source(path));
}

test('core Worker routes enrichment through a bounded sequential Queue wrapper', () => {
  const runtime = config('../wrangler.runtime.jsonc');
  const entry = source('../src/minute-enrichment-optimized-entry.js');
  const router = source('../src/runtime-orchestrator-entry.js');
  const enrichment = runtime.queues.consumers.find(
    ({ queue }) => queue === 'stationhead-minute-enrichment',
  );
  assert.equal(runtime.main, 'src/runtime-orchestrator-deployed-entry.js');
  assert.equal(enrichment.max_batch_size, 1);
  assert.equal(enrichment.max_concurrency, 1);
  assert.match(router, /minute-enrichment-optimized-entry\.js/);
  assert.match(entry, /processMinuteEnrichmentMessage/);
  assert.match(entry, /for \(const message of messages\)/);
  assert.match(entry, /function logMinuteEnrichmentResult/);
  assert.doesNotMatch(entry, /Promise\.all\(messages|Symbol\.iterator|fetch\s*\(/);
});

test('retired Worker rebuild and maintenance entrypoints stay deleted', () => {
  const runtime = config('../wrangler.runtime.jsonc');
  const runtimeEnv = source('../src/runtime-env.js');
  const pipeline = source('../src/minute-pipeline-entry.js');
  const liveRecovery = source('../src/minute-maintenance-entry.js');

  for (const path of [
    '../src/minute-rebuild-batched-entry.js',
    '../src/minute-rebuild-maintenance-entry.js',
    '../src/minute-maintenance-optimized-entry.js',
    '../src/minute-fact-repair-burst.js',
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
  }

  assert.equal(runtime.queues.consumers.some(
    ({ queue }) => queue === 'stationhead-minute-rebuild',
  ), false);
  assert.equal(runtime.queues.producers.some(
    ({ binding }) => binding === 'MINUTE_DERIVE_QUEUE',
  ), false);
  assert.equal(runtime.queues.consumers.find(
    ({ queue }) => queue === 'stationhead-minute-derive',
  ).max_concurrency, 1);
  assert.doesNotMatch(runtimeEnv, /stationhead-minute-rebuild/);
  assert.doesNotMatch(pipeline, /minute-rebuild-batched-entry|MINUTE_REBUILD_QUEUE_NAME/);
  assert.match(pipeline, /repair-actions-owned/);
  assert.match(pipeline, /rebuild-actions-owned/);
  assert.match(liveRecovery, /MINUTE_LIVE_DERIVE_QUEUE/);
  assert.doesNotMatch(liveRecovery, /MINUTE_REBUILD_QUEUE|runMinuteScheduled|scheduled\s*:|repair/);
});

test('Actions owns offline maintenance scheduling', () => {
  const workflow = source('../../.github/workflows/run-runtime-offline-maintenance.yml');
  const runner = source('../scripts/run-runtime-offline-maintenance-actions.mjs');
  const runtime = config('../wrangler.runtime.jsonc');

  assert.match(workflow, /run-runtime-offline-maintenance-actions\.mjs/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(runner, /runRuntimeOfflineMaintenanceActions/);
  assert.match(runner, /runtime offline maintenance deadline exceeded/);
  assert.equal(runtime.triggers, undefined);
});
