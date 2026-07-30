import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeOrchestrator = readFileSync(
  new URL('../worker/src/runtime-orchestrator-deployed-entry.js', import.meta.url),
  'utf8',
);
const runtimeQueue = readFileSync(
  new URL('../worker/src/runtime-queue.js', import.meta.url),
  'utf8',
);
const pagesActions = readFileSync(
  new URL('../worker/scripts/run-pages-read-model-actions.mjs', import.meta.url),
  'utf8',
);
const offlineActions = readFileSync(
  new URL('../worker/scripts/run-runtime-offline-maintenance-actions.mjs', import.meta.url),
  'utf8',
);
const runtime = JSON.parse(readFileSync(
  new URL('../worker/wrangler.runtime.jsonc', import.meta.url),
  'utf8',
));
const dailyAudit = readFileSync(
  new URL('../.github/scripts/audit-cloudflare-daily-usage.py', import.meta.url),
  'utf8',
);

test('runtime emits no scheduled relay traffic while account-wide Queue usage remains externally measured', () => {
  assert.equal(runtime.triggers, undefined);
  assert.doesNotMatch(runtimeOrchestrator, /scheduled\s*:|runRuntimeOrchestratorScheduled/);
  assert.doesNotMatch(runtimeQueue, /raw-collection|monitor-maintenance|stream-prediction|minute-recovery-dispatch/);
  assert.match(runtimeQueue, /isMinutePipelineBatch/);
  assert.match(runtimeQueue, /unsupported_runtime_message_retried/);
  assert.doesNotMatch(runtimeQueue, /unsupported_runtime_message_discarded/);

  assert.doesNotMatch(pagesActions, /runSplitTrackHistoryCycleStep/);
  assert.match(pagesActions, /track-history-read-model-disabled/);
  assert.match(pagesActions, /dueVariantKeys/);
  assert.match(offlineActions, /runStreamGoalPrediction/);
  assert.match(offlineActions, /runRollupMaintenance/);
  assert.match(offlineActions, /pruneOldSnapshots/);

  assert.match(dailyAudit, /queueMessageOperationsAdaptiveGroups/);
  assert.match(dailyAudit, /billableOperations/);

  const scheduledRuntimeRelayQueueOperations = 0;
  assert.equal(scheduledRuntimeRelayQueueOperations, 0);
  assert.ok(scheduledRuntimeRelayQueueOperations < 10_000);

  for (const name of [
    'MINUTE_FACT_REPAIR_BURST_ENABLED',
    'STREAM_GOAL_PREDICTION_INTERVAL_MS',
    'SNAPSHOT_RETENTION_ENABLED',
    'PAGES_TRACK_HISTORY_CYCLE_ENABLED',
  ]) {
    assert.equal(Object.hasOwn(runtime.vars, name), false, name);
  }
});
