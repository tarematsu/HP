import './fetch-guard.js';

export const ROLLUP_MAINTENANCE_CRON = '30 * * * *';
export const SNAPSHOT_RETENTION_CRON = '50 * * * *';

const EMPTY_DEPENDENCIES = Object.freeze({});
const OTHER_CRON_ID = 'other-cron';
let cronStaggerModulePromise;
let rollupModulePromise;
let retentionModulePromise;

function enabled(value) {
  return value === true || value === 1 || /^(1|true|yes|on)$/i.test(String(value || ''));
}

function loadCronStaggerModule() {
  cronStaggerModulePromise ||= import('./cron-stagger.js');
  return cronStaggerModulePromise;
}

function loadRollupModule() {
  rollupModulePromise ||= import('./rollup-maintenance.js');
  return rollupModulePromise;
}

function loadRetentionModule() {
  retentionModulePromise ||= import('./snapshot-retention.js');
  return retentionModulePromise;
}

function scheduledTimestamp(controller) {
  const value = controller?.scheduledTime;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : Date.now();
  }
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : Date.now();
}

function monitorCron(controller) {
  const value = controller?.cron;
  if (value === ROLLUP_MAINTENANCE_CRON || value === SNAPSHOT_RETENTION_CRON) return value;
  return String(value || '');
}

async function collectorGate(env, now, dependencies = EMPTY_DEPENDENCIES) {
  if (!env?.BUDDIES_DB?.prepare && !dependencies.waitForCollector) return null;
  const waitForCollector = dependencies.waitForCollector
    || (await loadCronStaggerModule()).waitForCollectorCompletion;
  return waitForCollector(env, now);
}

function assertMaintenanceSucceeded(kind, result) {
  const reason = result?.reason;
  if (reason === 'maintenance-error' || reason === 'retention-error' || reason === 'db-binding-missing') {
    throw new Error(`${kind} failed: ${result?.error || reason}`);
  }
  return result;
}

async function recordMaintenanceStatus(env, now, error = null) {
  if (!env?.OTHER_DB?.prepare) return;
  const message = error ? String(error?.message || error).slice(0, 1000) : null;
  await env.OTHER_DB.prepare(`INSERT INTO sh_collector_status(
      collector_id,status,last_attempt_at,last_success_at,last_error,updated_at
    ) VALUES(?,?,?,?,?,?)
    ON CONFLICT(collector_id) DO UPDATE SET
      status=excluded.status,last_attempt_at=excluded.last_attempt_at,
      last_success_at=CASE WHEN excluded.status='ok'
        THEN excluded.last_success_at ELSE sh_collector_status.last_success_at END,
      last_error=excluded.last_error,updated_at=excluded.updated_at`)
    .bind(
      OTHER_CRON_ID,
      message ? 'error' : 'ok',
      now,
      message ? null : now,
      message,
      now,
    ).run();
}

export async function runMonitorMaintenanceCron(controller, env, dependencies = EMPTY_DEPENDENCIES) {
  const cron = monitorCron(controller);
  if (cron !== ROLLUP_MAINTENANCE_CRON && cron !== SNAPSHOT_RETENTION_CRON) {
    return { skipped: true, reason: 'unsupported-monitor-maintenance-cron', cron };
  }

  const now = scheduledTimestamp(controller);
  try {
    const applyStagger = dependencies.applyStagger
      || (await loadCronStaggerModule()).applyCronStagger;
    await applyStagger(env, 'other');

    const collector = await collectorGate(env, now, dependencies);
    if (collector && !collector.ready) {
      const result = { skipped: true, reason: collector.reason, targetMinute: collector.targetMinute };
      await recordMaintenanceStatus(env, now);
      return result;
    }

    let result;
    if (cron === ROLLUP_MAINTENANCE_CRON) {
      if (!env?.BUDDIES_DB || !env?.OTHER_DB) {
        result = assertMaintenanceSucceeded(
          'rollup maintenance',
          { skipped: true, reason: 'db-binding-missing' },
        );
      } else {
        const runRollup = dependencies.runRollup
          || (await loadRollupModule()).runRollupMaintenanceSafely;
        const repairDb = enabled(env?.MINUTE_FACT_REPAIR_BURST_ENABLED) ? env.MINUTE_DB : null;
        result = assertMaintenanceSucceeded(
          'rollup maintenance',
          await runRollup(env.BUDDIES_DB, env.OTHER_DB, repairDb, now),
        );
      }
    } else {
      const pruneSnapshots = dependencies.pruneSnapshots
        || (await loadRetentionModule()).pruneOldSnapshotsSafely;
      result = assertMaintenanceSucceeded('snapshot retention', await pruneSnapshots(env, now));
    }
    await recordMaintenanceStatus(env, now);
    return result;
  } catch (error) {
    try {
      await recordMaintenanceStatus(env, now, error);
    } catch (recordError) {
      console.error(JSON.stringify({
        event: 'monitor_maintenance_status_failed',
        error: String(recordError?.message || recordError).slice(0, 500),
      }));
    }
    throw error;
  }
}

export default {
  scheduled: runMonitorMaintenanceCron,
};
