import { collectorReadyForMaintenance } from './collector-coordinator-status.js';
import {
  MINUTE_FACT_MAINTENANCE_CRON,
  minuteMaintenanceTask,
  runMinuteScheduledWithCollectorPriority,
} from './minute-entry.js';
import { throwIfSoftFailure } from './soft-failure.js';

const MINUTE_DERIVE_DISPATCH_CRON = '* * * * *';
const EMPTY_DEPENDENCIES = Object.freeze({});
let maintenanceEntryPromise = null;
let rebuildMaintenanceEntryPromise = null;

function loadMaintenanceEntry() {
  if (!maintenanceEntryPromise) {
    maintenanceEntryPromise = import('./minute-maintenance-entry.js');
  }
  return maintenanceEntryPromise;
}

function loadRebuildMaintenanceEntry() {
  if (!rebuildMaintenanceEntryPromise) {
    rebuildMaintenanceEntryPromise = import('./minute-rebuild-maintenance-entry.js');
  }
  return rebuildMaintenanceEntryPromise;
}

function scheduledTimestamp(controller) {
  const value = controller?.scheduledTime;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : Date.now();
  }
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : Date.now();
}

function isDeriveDispatchCron(controller) {
  const value = controller?.cron;
  return value === MINUTE_DERIVE_DISPATCH_CRON
    || String(value || '') === MINUTE_DERIVE_DISPATCH_CRON;
}

function maintenanceMessage(controller, task) {
  const scheduledAt = scheduledTimestamp(controller);
  return {
    message_type: 'minute-rebuild-stage',
    message_version: 1,
    run_id: `minute-maintenance:${task}:${scheduledAt}`,
    stage: 'maintenance-gate',
    maintenance_task: task,
    scheduled_at: scheduledAt,
    cron: MINUTE_FACT_MAINTENANCE_CRON,
    attempt: 0,
  };
}

export async function dispatchMinuteMaintenanceGate(
  controller,
  env,
  task,
  ctx = null,
  dependencies = EMPTY_DEPENDENCIES,
) {
  if (!env?.MINUTE_REBUILD_QUEUE?.send) {
    const run = dependencies.runScheduled || runMinuteScheduledWithCollectorPriority;
    const result = await run(controller, env, ctx, dependencies.direct || EMPTY_DEPENDENCIES);
    throwIfSoftFailure(result, 'minute maintenance direct fallback');
    return result;
  }
  const message = maintenanceMessage(controller, task);
  const maintenance = await loadRebuildMaintenanceEntry();
  const result = await maintenance.processMinuteMaintenanceGate(env, message, {
    checkCollector: collectorReadyForMaintenance,
  });
  console.log(JSON.stringify({
    event: 'minute_maintenance_gate_inlined',
    task,
    run_id: message.run_id,
    pending: result?.pending === true,
    skipped: result?.skipped === true,
    reason: result?.reason,
    requeued: result?.requeued === true,
    dispatched_stage: result?.dispatched_stage,
    historical_backfill_due: result?.historical_backfill_due,
  }));
  return result;
}

export async function runMinuteMaintenanceSyncInline(
  controller,
  env,
  ctx = null,
  dependencies = EMPTY_DEPENDENCIES,
) {
  const message = { ...maintenanceMessage(controller, 'sync'), stage: 'maintenance-run' };
  const maintenance = dependencies.maintenance || await loadRebuildMaintenanceEntry();
  const processSync = dependencies.processMinuteMaintenanceSync
    || maintenance.processMinuteMaintenanceSync;
  const runScheduled = dependencies.runScheduled
    || ((scheduledController, activeEnv) => runMinuteScheduledWithCollectorPriority(
      scheduledController,
      activeEnv,
      ctx,
      EMPTY_DEPENDENCIES,
    ));
  const result = await processSync(env, message, {
    clearCompletedPayloads: dependencies.clearCompletedPayloads,
    runScheduled,
  });
  throwIfSoftFailure(result, 'minute maintenance sync');
  console.log(JSON.stringify({
    event: 'minute_maintenance_sync_inlined',
    task: 'sync',
    run_id: message.run_id,
    pending: result?.pending === true,
    skipped: result?.result?.skipped === true,
    reason: result?.result?.reason,
    payloads_cleared: result?.payload_cleanup?.cleared,
  }));
  return { ...result, inline: true };
}

export async function runMinuteMaintenanceRecoveryInline(
  controller,
  env,
  ctx = null,
  dependencies = EMPTY_DEPENDENCIES,
) {
  const message = { ...maintenanceMessage(controller, 'recovery'), stage: 'maintenance-run' };
  const maintenance = dependencies.maintenance || await loadRebuildMaintenanceEntry();
  const processRun = dependencies.processMinuteMaintenanceRun
    || maintenance.processMinuteMaintenanceRun;
  const result = await processRun(env, message, {
    runScheduled: dependencies.runScheduled,
  });
  throwIfSoftFailure(result, 'minute maintenance recovery');
  console.log(JSON.stringify({
    event: 'minute_maintenance_recovery_inlined',
    task: 'recovery',
    run_id: message.run_id,
    pending: result?.pending === true,
    skipped: result?.result?.skipped === true,
    reason: result?.result?.reason,
  }));
  return { ...result, inline: true };
}

export async function runMinuteMaintenanceScheduled(
  controller,
  env,
  ctx,
  dependencies = EMPTY_DEPENDENCIES,
) {
  if (isDeriveDispatchCron(controller)) {
    const entry = await loadMaintenanceEntry();
    return entry.dispatchPendingMinuteFacts(env, EMPTY_DEPENDENCIES, ctx);
  }
  const task = minuteMaintenanceTask(controller);
  if (task === 'sync') {
    return runMinuteMaintenanceSyncInline(controller, env, ctx, dependencies);
  }
  if (task === 'rebuild') {
    return dispatchMinuteMaintenanceGate(controller, env, task, ctx, dependencies);
  }
  return runMinuteScheduledWithCollectorPriority(controller, env, ctx, EMPTY_DEPENDENCIES);
}

export default {
  scheduled: runMinuteMaintenanceScheduled,
};
