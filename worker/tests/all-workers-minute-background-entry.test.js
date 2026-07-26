import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function config(path) {
  return JSON.parse(source(path));
}

test('core Worker routes enrichment through a queue-only one-message wrapper', () => {
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
  assert.match(entry, /const message = messages\[0\]/);
  assert.match(entry, /function logMinuteEnrichmentResult/);
  assert.doesNotMatch(entry, /Symbol\.iterator|fetch\s*\(/);
});

test('legacy rebuild primitives remain source-only after Actions migration', () => {
  const runtime = config('../wrangler.runtime.jsonc');
  const runtimeEnv = source('../src/runtime-env.js');
  const pipeline = source('../src/minute-pipeline-entry.js');
  const wrapper = source('../src/minute-rebuild-batched-entry.js');
  const core = source('../src/minute-rebuild-entry.js');
  const rebuild = runtime.queues.consumers.find(({ queue }) => queue === 'stationhead-minute-rebuild');
  assert.equal(rebuild, undefined);
  assert.doesNotMatch(runtimeEnv, /stationhead-minute-rebuild/);
  assert.doesNotMatch(pipeline, /minute-rebuild-batched-entry|MINUTE_REBUILD_QUEUE_NAME/);
  assert.match(core, /runtimeStateModulePromise \|\|=/);
  assert.match(core, /gapScanModulePromise \|\|=/);
  assert.match(core, /backfillModulePromise \|\|=/);
  assert.match(wrapper, /for \(const message of messages\)/);
  assert.match(wrapper, /processMinuteMaintenanceGate/);
  assert.match(wrapper, /processMinuteRebuildStage/);
  assert.doesNotMatch(wrapper, /fetch\s*\(/);
});

test('Actions owns maintenance scheduling while compatibility primitives stay bounded', () => {
  const workflow = source('../../.github/workflows/run-runtime-offline-maintenance.yml');
  const runner = source('../scripts/run-runtime-offline-maintenance-actions.mjs');
  const wrapper = source('../src/minute-maintenance-optimized-entry.js');
  const runtime = config('../wrangler.runtime.jsonc');

  assert.match(workflow, /run-runtime-offline-maintenance-actions\.mjs/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(runner, /runRuntimeOfflineMaintenanceActions/);
  assert.match(runner, /runtime offline maintenance deadline exceeded/);
  assert.match(wrapper, /loadRebuildMaintenanceEntry/);
  assert.match(wrapper, /processMinuteMaintenanceGate\(env, message,/);
  assert.doesNotMatch(wrapper, /JSON_QUEUE_SEND_OPTIONS|maintenanceDelaySeconds/);
  assert.doesNotMatch(wrapper, /setTimeout|waitForCollectorCompletion|fetch\s*:/);
  assert.equal(runtime.triggers, undefined);
});
