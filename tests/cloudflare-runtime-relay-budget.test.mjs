import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeScheduled = readFileSync(
  new URL('../worker/src/runtime-scheduled.js', import.meta.url),
  'utf8',
);
const runtimeOrchestrator = readFileSync(
  new URL('../worker/src/runtime-orchestrator-deployed-entry.js', import.meta.url),
  'utf8',
);
const pagesReadModel = readFileSync(
  new URL('../worker/src/pages-read-model-entry.js', import.meta.url),
  'utf8',
);
const runtime = JSON.parse(readFileSync(
  new URL('../worker/wrangler.runtime.jsonc', import.meta.url),
  'utf8',
));

test('runtime recovery, repair, and dashboard work stay outside the Cron CPU path and Queue budget', () => {
  assert.doesNotMatch(runtimeScheduled, /dispatchMinuteRecoveryWithFallback/);
  assert.match(runtimeScheduled, /dispatchMinuteGateWithFallback/);
  assert.match(runtimeScheduled, /body !== rawMessage && body !== gateMessage/);
  assert.doesNotMatch(runtimeScheduled, /inline_minute_recovery_failed/);
  assert.match(runtimeScheduled, /inline_minute_maintenance_gate_failed/);
  assert.match(runtimeScheduled, /MINUTE_RECOVERY_POLL_INTERVAL_MINUTES = 15/);
  assert.match(runtimeOrchestrator, /minuteFactRepairBurstDue/);
  assert.match(runtimeOrchestrator, /repair-burst-cadence/);
  assert.match(pagesReadModel, /PAGES_DASHBOARD_MATERIALIZATION_MESSAGE/);
  assert.match(pagesReadModel, /dispatchPagesDashboardMaterialization/);

  // Prediction: 48/day; hourly maintenance: 48/day; heavy Pages variants:
  // 17/day; pathological raw fallback: two messages every five minutes;
  // recovery relay: one message every fifteen minutes.
  const healthyMessages = 48 + 48 + 17 + 288 * 2 + 96;
  const healthyQueueOperations = healthyMessages * 3;
  assert.equal(healthyQueueOperations, 2_355);

  const repairRunsPerDay = 1_440 / runtime.vars.MINUTE_FACT_REPAIR_BURST_INTERVAL_MINUTES;
  const repairJobsPerDay = repairRunsPerDay * runtime.vars.MINUTE_FACT_REPAIR_DISPATCH_LIMIT;
  const chunksPerRepairJob = Math.ceil(
    runtime.vars.QUEUE_INITIAL_TRACKS / runtime.vars.DERIVE_REVISION_CHUNK_TRACKS,
  );
  // Each repair uses trigger, write, rebuild-write, complete, plus revision chunks.
  const messagesPerRepairJob = 4 + chunksPerRepairJob;
  const repairMessages = repairRunsPerDay + repairJobsPerDay * messagesPerRepairJob;
  const repairQueueOperations = repairMessages * 3;
  assert.equal(repairRunsPerDay, 24);
  assert.equal(messagesPerRepairJob, 6);
  assert.equal(repairQueueOperations, 936);

  // Dashboard materialization is isolated from Cron every five minutes.
  const dashboardMessagesPerDay = 1_440 / 5;
  const dashboardQueueOperations = dashboardMessagesPerDay * 3;
  assert.equal(dashboardQueueOperations, 864);

  const projectedQueueOperations = healthyQueueOperations
    + repairQueueOperations
    + dashboardQueueOperations;
  assert.equal(projectedQueueOperations, 4_155);
  assert.ok(projectedQueueOperations < 8_000);

  // Keep headroom for retries and stale queued work by doubling repair traffic.
  const doubledRepairQueueOperations = healthyQueueOperations
    + repairQueueOperations * 2
    + dashboardQueueOperations;
  assert.equal(doubledRepairQueueOperations, 5_091);
  assert.ok(doubledRepairQueueOperations < 8_000);

  // If every maintenance gate also falls back to Queue, the policy still passes.
  const fullGateFallbackQueueOperations = projectedQueueOperations + 432 * 3;
  assert.equal(fullGateFallbackQueueOperations, 5_451);
  assert.ok(fullGateFallbackQueueOperations < 8_000);
});
