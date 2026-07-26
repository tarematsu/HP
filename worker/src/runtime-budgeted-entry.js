import {
  MONITOR_MAINTENANCE_MESSAGE,
  RUNTIME_CRON,
  RUNTIME_MINUTE_GATE_MESSAGE,
  RUNTIME_MINUTE_RECOVERY_MESSAGE,
  RUNTIME_STREAM_PREDICTION_MESSAGE,
  dispatchMinuteMaintenanceGate,
  dispatchMinuteRecovery,
  maintenanceCronFor,
  minuteMaintenanceTaskFor,
  minuteRecoveryPollDue,
  streamPredictionDue,
} from './runtime-scheduled.js';
import {
  runMinuteMaintenanceRecoveryInline,
  runMinuteMaintenanceSyncInline,
} from './minute-maintenance-optimized-entry.js';
import {
  pagesVariantDispatchDue,
  runPagesDashboardMaterialization,
} from './pages-read-model-entry.js';
import { runDispatchedPagesReadModelTask } from './pages-read-model-dispatch.js';

const EMPTY_DEPENDENCIES = Object.freeze({});
const JSON_QUEUE_SEND_OPTIONS = Object.freeze({ contentType: 'json' });
const DEFAULT_DASHBOARD_INTERVAL_MINUTES = 15;
const MINUTE_MS = 60_000;
const PRODUCER_WORKER = 'sh-runtime-orchestrator';

const QUEUE_OPERATIONS = Object.freeze({
  HOST_MONITOR_QUEUE: 'runtime-fallback',
  MINUTE_FACT_QUEUE: 'minute-fact',
  MINUTE_DERIVE_QUEUE: 'minute-derive',
  MINUTE_LIVE_DERIVE_QUEUE: 'minute-live-derive',
  MINUTE_ENRICHMENT_QUEUE: 'minute-enrichment',
  MINUTE_REBUILD_QUEUE: 'minute-rebuild',
  TRACK_METADATA_QUEUE: 'track-metadata',
  READ_MODEL_QUEUE: 'read-model',
  PAGES_READ_MODEL_QUEUE: 'pages-read-model',
});

let monitorMaintenanceModulePromise;
let streamPredictionModulePromise;

function enabled(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function actionsMaintenanceEnabled(env = {}) {
  return enabled(env?.MINUTE_FACT_ACTIONS_MAINTENANCE_ENABLED, false);
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function scheduledTimestamp(controller) {
  const parsed = Number(controller?.scheduledTime);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Date.now();
}

export function dashboardIntervalMinutes(env = {}) {
  return positiveInteger(
    env?.PAGES_DASHBOARD_MATERIALIZATION_INTERVAL_MINUTES,
    DEFAULT_DASHBOARD_INTERVAL_MINUTES,
    24 * 60,
  );
}

export function dashboardMaterializationDue(timestamp, env = {}) {
  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed < 0) return false;
  return Math.floor(parsed / MINUTE_MS) % dashboardIntervalMinutes(env) === 0;
}

export function pagesScheduledDue(timestamp, env = {}) {
  return enabled(env?.PAGES_TRACK_HISTORY_CYCLE_ENABLED, false)
    || pagesVariantDispatchDue(timestamp)
    || dashboardMaterializationDue(timestamp, env);
}

function attributedBody(body, operationName) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  return {
    ...body,
    producer_worker: body.producer_worker || PRODUCER_WORKER,
    operation_name: body.operation_name || operationName,
  };
}

function attributedQueue(queue, operationName) {
  if (!queue || (typeof queue !== 'object' && typeof queue !== 'function')) return queue;
  return new Proxy(queue, {
    get(target, property) {
      if (property === 'send' && typeof target.send === 'function') {
        return (body, options) => target.send(attributedBody(body, operationName), options);
      }
      if (property === 'sendBatch' && typeof target.sendBatch === 'function') {
        return (entries) => target.sendBatch((Array.isArray(entries) ? entries : []).map((entry) => ({
          ...entry,
          body: attributedBody(entry?.body, operationName),
        })));
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function attributedRuntimeEnv(env = {}) {
  const scoped = Object.create(env || null);
  for (const [binding, operationName] of Object.entries(QUEUE_OPERATIONS)) {
    const queue = env?.[binding];
    if (!queue) continue;
    Object.defineProperty(scoped, binding, {
      value: attributedQueue(queue, operationName),
      enumerable: true,
      configurable: true,
    });
  }
  return scoped;
}

async function loadMonitorMaintenanceModule() {
  monitorMaintenanceModulePromise ||= import('./monitor-maintenance-entry.js');
  return monitorMaintenanceModulePromise;
}

async function loadStreamPredictionModule() {
  streamPredictionModulePromise ||= import('./runtime-stream-prediction-dispatch.js');
  return streamPredictionModulePromise;
}

async function queueFallback(env, body, error) {
  const queue = env?.HOST_MONITOR_QUEUE;
  if (!queue?.send) throw error;
  await queue.send(attributedBody(body, 'runtime-fallback'), JSON_QUEUE_SEND_OPTIONS);
  return {
    inline: false,
    fallback: true,
    message_type: body.message_type,
    error: String(error?.message || error).slice(0, 300),
  };
}

async function runInlineWithFallback(env, body, run) {
  try {
    return { inline: true, fallback: false, result: await run() };
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'runtime_inline_task_failed',
      message_type: body.message_type,
      operation_name: body.operation_name || null,
      error: String(error?.message || error).slice(0, 500),
    }));
    return queueFallback(env, body, error);
  }
}

export async function runBudgetedRuntimeScheduled(
  controller,
  env,
  ctx,
  dependencies = EMPTY_DEPENDENCIES,
) {
  const cron = String(controller?.cron || '');
  if (cron !== RUNTIME_CRON) {
    return { skipped: true, reason: 'unsupported-runtime-cron', cron };
  }
  const scheduledAt = scheduledTimestamp(controller);
  const activeEnv = attributedRuntimeEnv(env);
  const jobs = [];

  if (!actionsMaintenanceEnabled(activeEnv) && minuteRecoveryPollDue(scheduledAt)) {
    const body = attributedBody({
      message_type: RUNTIME_MINUTE_RECOVERY_MESSAGE,
      message_version: 1,
      scheduled_at: scheduledAt,
    }, 'minute-recovery');
    jobs.push(runInlineWithFallback(activeEnv, body, () => dispatchMinuteRecovery(
      { ...controller, scheduledTime: scheduledAt },
      activeEnv,
      ctx,
      dependencies,
    )));
  }

  const minuteTask = actionsMaintenanceEnabled(activeEnv)
    ? null
    : minuteMaintenanceTaskFor(scheduledAt);
  if (minuteTask) {
    const body = attributedBody({
      message_type: RUNTIME_MINUTE_GATE_MESSAGE,
      message_version: 1,
      task: minuteTask,
      scheduled_at: scheduledAt,
    }, `minute-${minuteTask}`);
    const scheduledController = { ...controller, scheduledTime: scheduledAt };
    if (minuteTask === 'recovery') {
      const run = dependencies.runMinuteRecovery || runMinuteMaintenanceRecoveryInline;
      jobs.push(runInlineWithFallback(activeEnv, body, () => run(
        scheduledController,
        activeEnv,
        ctx,
        dependencies,
      )));
    } else if (minuteTask === 'sync') {
      const run = dependencies.runMinuteSync || runMinuteMaintenanceSyncInline;
      jobs.push(runInlineWithFallback(activeEnv, body, () => run(
        scheduledController,
        activeEnv,
        ctx,
        dependencies,
      )));
    } else {
      jobs.push(runInlineWithFallback(activeEnv, body, () => dispatchMinuteMaintenanceGate(
        scheduledController,
        activeEnv,
        minuteTask,
        ctx,
        dependencies,
      )));
    }
  }

  if (streamPredictionDue(scheduledAt)) {
    const body = attributedBody({
      message_type: RUNTIME_STREAM_PREDICTION_MESSAGE,
      message_version: 1,
      scheduled_at: scheduledAt,
    }, 'stream-prediction');
    jobs.push(runInlineWithFallback(activeEnv, body, async () => {
      const run = dependencies.runStreamPrediction
        || (await loadStreamPredictionModule()).dispatchStreamPrediction;
      return run(
        { ...controller, scheduledTime: scheduledAt },
        activeEnv,
        ctx,
        dependencies.streamPredictionOptions || EMPTY_DEPENDENCIES,
      );
    }));
  }

  const maintenanceCron = maintenanceCronFor(scheduledAt);
  if (maintenanceCron) {
    const body = attributedBody({
      message_type: MONITOR_MAINTENANCE_MESSAGE,
      message_version: 1,
      cron: maintenanceCron,
      scheduled_at: scheduledAt,
    }, 'monitor-maintenance');
    jobs.push(runInlineWithFallback(activeEnv, body, async () => {
      const run = dependencies.runMonitorMaintenance
        || (await loadMonitorMaintenanceModule()).runMonitorMaintenanceCron;
      return run(
        { cron: maintenanceCron, scheduledTime: scheduledAt },
        activeEnv,
        dependencies.maintenanceDependencies || EMPTY_DEPENDENCIES,
      );
    }));
  }

  if (!jobs.length) return { skipped: true, reason: 'no-runtime-task-due', scheduled_at: scheduledAt };
  return { scheduled_at: scheduledAt, tasks: await Promise.all(jobs) };
}

export async function runBudgetedPagesScheduled(
  controller,
  env,
  dependencies = EMPTY_DEPENDENCIES,
) {
  const scheduledAt = scheduledTimestamp(controller);
  if (!pagesScheduledDue(scheduledAt, env)) {
    return { skipped: true, reason: 'no-pages-task-due', scheduled_at: scheduledAt };
  }
  const activeEnv = attributedRuntimeEnv(env);
  const jobs = [];
  const cycleEnabled = enabled(activeEnv?.PAGES_TRACK_HISTORY_CYCLE_ENABLED, false);
  if (cycleEnabled || pagesVariantDispatchDue(scheduledAt)) {
    const runTask = dependencies.runTask || runDispatchedPagesReadModelTask;
    jobs.push(runTask(activeEnv, scheduledAt, dependencies));
  }
  if (dashboardMaterializationDue(scheduledAt, activeEnv)) {
    const runDashboard = dependencies.runDashboard || runPagesDashboardMaterialization;
    jobs.push(runDashboard(activeEnv, scheduledAt, dependencies));
  }
  const results = await Promise.all(jobs);
  return { skipped: false, scheduled_at: scheduledAt, results };
}

export async function runBudgetedCoreScheduled(
  controller,
  env,
  ctx,
  dependencies = EMPTY_DEPENDENCIES,
) {
  const [runtime, pages] = await Promise.all([
    runBudgetedRuntimeScheduled(controller, env, ctx, dependencies.runtime || EMPTY_DEPENDENCIES),
    runBudgetedPagesScheduled(controller, env, dependencies.pages || EMPTY_DEPENDENCIES),
  ]);
  return { runtime, pages };
}
