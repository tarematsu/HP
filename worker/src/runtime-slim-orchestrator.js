import { runCoreQueue } from './runtime-orchestrator-entry.js';
import {
  attributedRuntimeEnv,
  pagesScheduledDue,
  runBudgetedCoreScheduled,
} from './runtime-budgeted-entry.js';
import { runD1CoordinatedScheduled } from './runtime-d1-coordinator.js';
import {
  RUNTIME_CRON,
  maintenanceCronFor,
  minuteMaintenanceTaskFor,
  minuteRecoveryPollDue,
  streamPredictionDue,
} from './runtime-scheduled.js';

function enabled(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function actionsMaintenanceEnabled(env = {}) {
  return enabled(env?.MINUTE_FACT_ACTIONS_MAINTENANCE_ENABLED, false);
}

export function runtimeOrchestratorDue(controller, env = {}) {
  const cron = String(controller?.cron || '');
  if (cron !== RUNTIME_CRON) return true;
  const scheduledAt = Number(controller?.scheduledTime);
  const timestamp = Number.isFinite(scheduledAt) ? scheduledAt : Date.now();
  const workerMaintenanceDue = !actionsMaintenanceEnabled(env)
    && Boolean(minuteMaintenanceTaskFor(timestamp));
  return pagesScheduledDue(timestamp, env)
    || (!actionsMaintenanceEnabled(env) && minuteRecoveryPollDue(timestamp))
    || workerMaintenanceDue
    || streamPredictionDue(timestamp)
    || Boolean(maintenanceCronFor(timestamp));
}

async function skipDedicatedRawCollection() {
  return { skipped: true, reason: 'dedicated-buddies-collector' };
}

export async function runRuntimeWork(controller, env, ctx, dependencies = {}) {
  const direct = dependencies.direct || {};
  const runtime = direct.runtime || {};
  return (dependencies.runDirect || runBudgetedCoreScheduled)(
    controller,
    env,
    ctx,
    {
      ...direct,
      runtime: {
        ...runtime,
        dispatchRawCollection: runtime.dispatchRawCollection || skipDedicatedRawCollection,
      },
    },
  );
}

export async function runRuntimeOrchestratorScheduled(
  controller,
  env,
  ctx,
  dependencies = {},
) {
  if (!runtimeOrchestratorDue(controller, env)) {
    return {
      skipped: true,
      reason: 'no-runtime-or-pages-task-due',
      scheduled_at: Number(controller?.scheduledTime) || Date.now(),
    };
  }
  const run = (receivedController, receivedEnv, receivedCtx) => runRuntimeWork(
    receivedController,
    receivedEnv,
    receivedCtx,
    dependencies,
  );
  return runD1CoordinatedScheduled(controller, env, ctx, run, dependencies.lease || {});
}

export async function runRuntimeOrchestratorQueue(batch, env, ctx, dependencies = {}) {
  const run = dependencies.runCoreQueue || runCoreQueue;
  return run(batch, attributedRuntimeEnv(env), ctx, dependencies.core || {});
}
