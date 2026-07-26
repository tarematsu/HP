const EMPTY_OPTIONS = Object.freeze({});
const MINUTE_MS = 60_000;
const DEFAULT_RAW_COLLECTION_FALLBACK_INTERVAL_MINUTES = 5;

export const RUNTIME_CRON = '* * * * *';
export const CONSOLIDATED_MONITOR_CRON = RUNTIME_CRON;
export const ROLLUP_MAINTENANCE_CRON = '30 * * * *';
export const SNAPSHOT_RETENTION_CRON = '50 * * * *';
export const MONITOR_MAINTENANCE_MESSAGE = 'monitor-maintenance-task';
export const RAW_COLLECTION_TASK_MESSAGE = 'raw-collection-task';
export const RUNTIME_MINUTE_RECOVERY_MESSAGE = 'runtime-minute-recovery-dispatch';
export const RUNTIME_MINUTE_GATE_MESSAGE = 'runtime-minute-maintenance-gate-dispatch';
export const RUNTIME_STREAM_PREDICTION_MESSAGE = 'runtime-stream-prediction-dispatch';

let rawCollectionSessionModulePromise;
let rawCollectionFetchModulePromise;
let rawCollectionTextTransportModulePromise;
let runtimeEnvModulePromise;

function loadRawCollectionSessionModule() {
  rawCollectionSessionModulePromise ||= import('./raw-collection-session-entry.js');
  return rawCollectionSessionModulePromise;
}

function loadRawCollectionFetchModule() {
  rawCollectionFetchModulePromise ||= import('./raw-collection-fetch-entry.js');
  return rawCollectionFetchModulePromise;
}

function loadRawCollectionTextTransportModule() {
  rawCollectionTextTransportModulePromise ||= import('./raw-collection-text-transport.js');
  return rawCollectionTextTransportModulePromise;
}

function loadRuntimeEnvModule() {
  runtimeEnvModulePromise ||= import('./runtime-env.js');
  return runtimeEnvModulePromise;
}

function scheduledTimestamp(controller) {
  const value = Number(controller?.scheduledTime);
  return Number.isFinite(value) && value >= 0 ? value : Date.now();
}

export function maintenanceCronFor() {
  return null;
}

export function minuteMaintenanceTaskFor() {
  return null;
}

export function minuteRecoveryPollDue() {
  return false;
}

export function streamPredictionDue() {
  return false;
}

export function rawCollectionFallbackDue(timestamp, env = {}) {
  const configured = Number(env?.RAW_COLLECTION_FALLBACK_INTERVAL_MINUTES);
  const interval = Number.isFinite(configured) && configured > 0
    ? Math.max(1, Math.trunc(configured))
    : DEFAULT_RAW_COLLECTION_FALLBACK_INTERVAL_MINUTES;
  return Math.floor((Number(timestamp) || 0) / MINUTE_MS) % interval === 0;
}

export function runtimeScheduledMessagesFor(scheduledAt) {
  return [{
    message_type: RAW_COLLECTION_TASK_MESSAGE,
    message_version: 1,
    scheduled_at: scheduledAt,
  }];
}

async function dispatchRawCollectionInline(env, body, options) {
  if (options.dispatchRawCollection) return options.dispatchRawCollection(env, body);
  const [session, fetchStage, transport, runtimeEnv] = await Promise.all([
    loadRawCollectionSessionModule(),
    loadRawCollectionFetchModule(),
    loadRawCollectionTextTransportModule(),
    loadRuntimeEnvModule(),
  ]);
  const active = runtimeEnv.rawCollectorEnv(env);
  const fetchEnv = Object.create(active || null);
  Object.defineProperty(fetchEnv, 'RAW_COLLECTION_QUEUE', {
    value: transport.textTransportQueue(active?.RAW_COLLECTION_QUEUE),
    enumerable: false,
    configurable: true,
  });
  return session.prepareRawCollectionFetch(active, body, {
    send: (message) => fetchStage.fetchPreparedRawCollection(fetchEnv, message),
  });
}

async function dispatchRawCollectionWithFallback(env, body, options) {
  try {
    await dispatchRawCollectionInline(env, body, options);
    return { inline: true, fallback: false };
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'inline_raw_collection_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    if (!rawCollectionFallbackDue(body?.scheduled_at, env)) {
      return { inline: false, fallback: false, reason: 'queue-fallback-cadence' };
    }
    const queue = env?.HOST_MONITOR_QUEUE;
    if (!queue?.send) throw error;
    await queue.send(body, { contentType: 'json' });
    return { inline: false, fallback: true };
  }
}

export async function dispatchMinuteRecovery() {
  return null;
}

export async function dispatchMinuteMaintenanceGate() {
  return null;
}

export async function dispatchMinuteMaintenance() {
  return [];
}

export async function runRuntimeScheduled(controller, env, _ctx, options = EMPTY_OPTIONS) {
  const cron = String(controller?.cron || '');
  if (cron !== RUNTIME_CRON) {
    return { skipped: true, reason: 'unsupported-runtime-cron', cron };
  }
  const scheduledAt = scheduledTimestamp(controller);
  const body = runtimeScheduledMessagesFor(scheduledAt)[0];
  await dispatchRawCollectionWithFallback(env, body, options);
  return [{ dispatched: true, task: 'raw-collection', scheduled_at: scheduledAt }];
}

export const runConsolidatedMonitorScheduled = runRuntimeScheduled;
