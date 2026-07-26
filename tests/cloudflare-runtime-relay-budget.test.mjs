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
const runtimeDoOrchestrator = readFileSync(
  new URL('../worker/src/runtime-do-orchestrator.js', import.meta.url),
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
  assert.match(runtimeOrchestrator, /minuteFactRepairBurstDue/);
  assert.match(runtimeDoOrchestrator, /repair-burst-cadence/);
  assert.match(pagesReadModel, /PAGES_DASHBOARD_MATERIALIZATION_MESSAGE/);
  assert.match(pagesReadModel, /dispatchPagesDashboardMaterialization/);

  // This model covers only messages deterministically emitted by the runtime
  // relay and Pages dashboard schedules. It intentionally excludes collector,
  // derive-stage, retry, DLQ, and other Queue traffic. Account-wide enforcement
  // remains the unified Cloudflare GraphQL audit below.
  assert.match(dailyAudit, /queueMessageOperationsAdaptiveGroups/);
  assert.match(dailyAudit, /billableOperations/);

  // Prediction: 48/day; hourly maintenance: 48/day; heavy Pages variants:
  // 17/day; pathological raw fallback: two messages every five minutes;
  // recovery relay: one message every fifteen minutes.
  const runtimeRelayMessages = 48 + 48 + 17 + 288 * 2 + 96;
  const runtimeRelayQueueOperations = runtimeRelayMessages * 3;
  assert.equal(runtimeRelayQueueOperations, 2_355);

  // The July repair is complete and retired. No new repair burst belongs in
  // this runtime relay subset. Stale repair stages are handled separately by
  // the Queue retirement guard and by account-wide observability.
  assert.equal(runtime.vars.MINUTE_FACT_REPAIR_BURST_ENABLED, false);
  const repairRelayQueueOperations = 0;
  assert.equal(repairRelayQueueOperations, 0);

  // Dashboard materialization is isolated from Cron every five minutes.
  const dashboardMessagesPerDay = 1_440 / 5;
  const dashboardQueueOperations = dashboardMessagesPerDay * 3;
  assert.equal(dashboardQueueOperations, 864);

  const modeledRuntimeSubset = runtimeRelayQueueOperations
    + repairRelayQueueOperations
    + dashboardQueueOperations;
  assert.equal(modeledRuntimeSubset, 3_219);
  assert.ok(modeledRuntimeSubset < 10_000);

  // Duplicate delivery of this modeled subset alone still has local headroom.
  // This is not an account-wide Queue forecast.
  const doubledRuntimeSubset = modeledRuntimeSubset * 2;
  assert.equal(doubledRuntimeSubset, 6_438);
  assert.ok(doubledRuntimeSubset < 10_000);

  // If every maintenance gate also falls back to Queue, the modeled subset
  // remains bounded; the account-wide audit is still authoritative.
  const fullGateFallbackRuntimeSubset = modeledRuntimeSubset + 432 * 3;
  assert.equal(fullGateFallbackRuntimeSubset, 4_515);
  assert.ok(fullGateFallbackRuntimeSubset < 10_000);
});
