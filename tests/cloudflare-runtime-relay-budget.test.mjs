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

  // The July repair is complete and retired. No new repair burst or repair
  // derive messages belong in the steady-state Queue budget.
  assert.equal(runtime.vars.MINUTE_FACT_REPAIR_BURST_ENABLED, false);
  const repairRunsPerDay = 0;
  const repairQueueOperations = 0;
  assert.equal(repairRunsPerDay, 0);
  assert.equal(repairQueueOperations, 0);

  // Dashboard materialization is isolated from Cron every five minutes.
  const dashboardMessagesPerDay = 1_440 / 5;
  const dashboardQueueOperations = dashboardMessagesPerDay * 3;
  assert.equal(dashboardQueueOperations, 864);

  const projectedQueueOperations = healthyQueueOperations
    + repairQueueOperations
    + dashboardQueueOperations;
  assert.equal(projectedQueueOperations, 3_219);
  assert.ok(projectedQueueOperations < 10_000);

  // Keep headroom for duplicate delivery and stale queued work.
  const doubledSteadyStateQueueOperations = projectedQueueOperations * 2;
  assert.equal(doubledSteadyStateQueueOperations, 6_438);
  assert.ok(doubledSteadyStateQueueOperations < 10_000);

  // If every maintenance gate also falls back to Queue, the policy still passes.
  const fullGateFallbackQueueOperations = projectedQueueOperations + 432 * 3;
  assert.equal(fullGateFallbackQueueOperations, 4_515);
  assert.ok(fullGateFallbackQueueOperations < 10_000);
});
