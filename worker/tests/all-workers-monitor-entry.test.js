import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('runtime deployment has only fetch and queue event surfaces', () => {
  const deployedEntry = source('../src/runtime-orchestrator-deployed-entry.js');
  assert.match(deployedEntry, /fetch:\s*baseWorker\.fetch/);
  assert.match(deployedEntry, /queue:\s*runRuntimeOrchestratorQueue/);
  assert.doesNotMatch(deployedEntry, /scheduled:/);

  const coreEntry = source('../src/runtime-orchestrator-entry.js');
  assert.match(coreEntry, /runCoreQueue/);
  assert.match(coreEntry, /runCoreFetch/);
  assert.doesNotMatch(coreEntry, /runCoreScheduled/);
  assert.doesNotMatch(coreEntry, /loadRuntimeScheduledModule/);
});

test('runtime queue no longer imports offline maintenance or collection graphs', () => {
  const queue = source('../src/runtime-queue.js');
  assert.match(queue, /isMinutePipelineBatch/);
  assert.match(queue, /unsupported_runtime_message_retried/);
  assert.doesNotMatch(queue, /unsupported_runtime_message_discarded/);
  assert.doesNotMatch(queue, /raw-collection-session|raw-collection-fetch/);
});

test('offline runtime coordinators are absent while live-job coordination remains isolated', () => {
  const config = JSON.parse(source('../wrangler.runtime.jsonc'));
  assert.equal(config.triggers, undefined);
  assert.deepEqual(config.durable_objects, {
    bindings: [{ name: 'MINUTE_LIVE_JOB_COORDINATOR', class_name: 'MinuteLiveJobCoordinator' }],
  });
  assert.equal(config.queues.consumers.some(({ queue }) => queue === 'stationhead-host-monitor'), false);
  assert.equal(config.queues.consumers.some(({ queue }) => queue.includes('read-model')), false);
  assert.equal(existsSync(new URL('../src/other-monitor-entry.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/runtime-other-monitor-dispatch.js', import.meta.url)), false);
});
