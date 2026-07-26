import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runRuntimeOfflineMaintenanceActions } from '../worker/scripts/run-runtime-offline-maintenance-actions.mjs';

const workflow = readFileSync(new URL('../.github/workflows/run-runtime-offline-maintenance.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../worker/scripts/run-runtime-offline-maintenance-actions.mjs', import.meta.url), 'utf8');
const deployed = readFileSync(new URL('../worker/src/runtime-orchestrator-deployed-entry.js', import.meta.url), 'utf8');
const runtime = JSON.parse(readFileSync(new URL('../worker/wrangler.runtime.jsonc', import.meta.url), 'utf8'));

test('offline runtime maintenance runs frequently as one bounded Actions job', () => {
  assert.match(workflow, /cron: '3,33 \* \* \* \*'/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /run-runtime-offline-maintenance-actions\.mjs/);
  assert.match(runner, /export async function runRuntimeOfflineMaintenanceActions/);
  assert.match(runner, /runtime offline maintenance deadline exceeded/);
});

test('Actions consolidates prediction rollup and retention without Worker queues', async () => {
  const calls = [];
  const now = 1_000;
  const result = await runRuntimeOfflineMaintenanceActions({
    now: () => now,
    env: { BUDDIES_DB: {}, OTHER_DB: {} },
    runPrediction: async () => { calls.push('prediction'); return 'prediction'; },
    runRollup: async () => { calls.push('rollup'); return 'rollup'; },
    runRetention: async () => { calls.push('retention'); return 'retention'; },
  });

  assert.deepEqual(calls, ['prediction', 'rollup', 'retention']);
  assert.deepEqual(result, {
    ok: true,
    event: 'runtime_offline_maintenance_actions_complete',
    elapsed_ms: 0,
    prediction: 'prediction',
    rollup: 'rollup',
    retention: 'retention',
  });
  assert.match(runner, /SNAPSHOT_RETENTION_BATCH_SIZE: 5000/);
  assert.match(runner, /SNAPSHOT_RETENTION_MAX_BATCHES: 100/);
  assert.match(runner, /STREAM_GOAL_PREDICTION_INTERVAL_MS: 30 \* 60_000/);
});

test('runtime deployment has no scheduled surface or offline relay queues', () => {
  assert.equal(runtime.triggers, undefined);
  assert.doesNotMatch(deployed, /scheduled\s*:|runRuntimeOrchestratorScheduled/);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue === 'stationhead-host-monitor'), false);
  assert.equal(runtime.queues.producers.some(({ binding }) => binding === 'HOST_MONITOR_QUEUE'), false);
});
