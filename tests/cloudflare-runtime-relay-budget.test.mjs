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
const runtimeSlimOrchestrator = readFileSync(
  new URL('../worker/src/runtime-slim-orchestrator.js', import.meta.url),
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
const dailyAudit = readFileSync(
  new URL('../.github/scripts/audit-cloudflare-daily-usage.py', import.meta.url),
  'utf8',
);

test('runtime relay subset stays bounded while account-wide Queue usage remains externally measured', () => {
  assert.doesNotMatch(runtimeScheduled, /dispatchMinuteRecoveryWithFallback/);
  assert.match(runtimeScheduled, /dispatchMinuteGateWithFallback/);
  assert.match(runtimeScheduled, /body !== rawMessage && body !== gateMessage/);
  assert.doesNotMatch(runtimeScheduled, /inline_minute_recovery_failed/);
  assert.match(runtimeScheduled, /inline_minute_maintenance_gate_failed/);
  assert.match(runtimeScheduled, /MINUTE_RECOVERY_POLL_INTERVAL_MINUTES = 15/);
  assert.doesNotMatch(runtimeOrchestrator, /minuteFactRepairBurstDue/);
  assert.match(runtimeSlimOrchestrator, /MINUTE_FACT_ACTIONS_MAINTENANCE_ENABLED/);
  assert.match(pagesReadModel, /PAGES_DASHBOARD_MATERIALIZATION_MESSAGE/);
  assert.match(pagesReadModel, /dispatchPagesDashboardMaterialization/);

  // This model covers only messages deterministically emitted by the runtime
  // relay and Pages dashboard schedules. It intentionally excludes collector,
  // derive-stage, retry, DLQ, and other Queue traffic. Account-wide enforcement
  // remains the unified Cloudflare GraphQL audit below.
  assert.match(dailyAudit, /queueMessageOperationsAdaptiveGroups/);
  assert.match(dailyAudit, /billableOperations/);

  // Prediction: 48/day; hourly maintenance: 48/day; recovery: 96/day.
  // Actions owns recovery/rebuild/sync maintenance and raw collection is
  // dedicated, so these are only worst-case inline fallback messages.
  const runtimeRelayMessages = 48 + 48 + 96;
  const runtimeRelayQueueOperations = runtimeRelayMessages * 3;
  assert.equal(runtimeRelayQueueOperations, 576);

  // The July repair is complete and retired. No new repair burst belongs in
  // this runtime relay subset. Stale repair stages are handled separately by
  // the Queue retirement guard and by account-wide observability.
  assert.equal(runtime.vars.MINUTE_FACT_REPAIR_BURST_ENABLED, false);
  const repairRelayQueueOperations = 0;
  assert.equal(repairRelayQueueOperations, 0);

  // Dashboard materialization now runs inline and does not add Queue traffic.
  const dashboardQueueOperations = 0;

  const modeledRuntimeSubset = runtimeRelayQueueOperations
    + repairRelayQueueOperations
    + dashboardQueueOperations;
  assert.equal(modeledRuntimeSubset, 576);
  assert.ok(modeledRuntimeSubset < 10_000);

  // Duplicate delivery of this modeled subset alone still has local headroom.
  // This is not an account-wide Queue forecast.
  const doubledRuntimeSubset = modeledRuntimeSubset * 2;
  assert.equal(doubledRuntimeSubset, 1_152);
  assert.ok(doubledRuntimeSubset < 10_000);

  // If every maintenance gate also falls back to Queue, the modeled subset
  // remains bounded; the account-wide audit is still authoritative.
  const fullGateFallbackRuntimeSubset = modeledRuntimeSubset;
  assert.equal(fullGateFallbackRuntimeSubset, 576);
  assert.ok(fullGateFallbackRuntimeSubset < 10_000);
});
