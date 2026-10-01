import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { recoverStalledMinuteFactJobs } from '../src/minute-facts-inbox.js';
import { runOfflineMinuteRebuilds } from '../src/minute-offline-rebuild.js';
import { runRollupMaintenance } from '../src/rollup-maintenance-coordinator.js';
import { pruneOldSnapshots } from '../src/snapshot-retention.js';
import { runStreamGoalPrediction } from '../src/stream-goal-prediction.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const RUNTIME_MAINTENANCE_COLLECTOR_ID = 'other-cron';
const RUNTIME_MAINTENANCE_MIN_INTERVAL_MS = 10 * 60_000;
const OFFLINE_REBUILD_COLLECTOR_ID = 'minute-offline-rebuild-actions';
const OFFLINE_REBUILD_MIN_INTERVAL_MS = 4 * 60 * 60_000;
const databases = {
  buddies: process.env.BUDDIES_DATABASE_NAME || 'stationhead-buddies',
  minute: process.env.FACTS_DATABASE_NAME || 'stationhead-minute',
  other: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
};

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function remoteDatabase(database, suffix) {
  return createWranglerRemoteD1({
    database,
    cwd: workerRoot,
    wranglerScript,
    tempPrefix: `.runtime-maintenance-${suffix}-`,
  });
}

function productionEnvironment() {
  return {
    BUDDIES_DB: remoteDatabase(databases.buddies, 'buddies'),
    MINUTE_DB: remoteDatabase(databases.minute, 'minute'),
    OTHER_DB: remoteDatabase(databases.other, 'other'),
    SNAPSHOT_RETENTION_ENABLED: true,
    SNAPSHOT_RETENTION_MS: 30 * 24 * 60 * 60_000,
    SNAPSHOT_RETENTION_INTERVAL_MS: 24 * 60 * 60_000,
    SNAPSHOT_RETENTION_BATCH_SIZE: 500,
    SNAPSHOT_RETENTION_MAX_BATCHES: 1,
    STREAM_GOAL_PREDICTION_INTERVAL_MS: 30 * 60_000,
  };
}

function timestamp(clock, fallback) {
  const value = Number(clock());
  return Number.isFinite(value) ? value : fallback;
}

function errorText(error) {
  return String(error?.message || error || 'runtime offline maintenance failed').slice(0, 1000);
}

function inboxRecoveryOptions(options, startedAt) {
  return {
    now: startedAt,
    limit: positiveInteger(
      options.inboxRecoveryLimit ?? process.env.MINUTE_FACT_STALLED_RECOVERY_LIMIT,
      1000,
      1,
      5000,
    ),
    deadLimit: positiveInteger(
      options.inboxDeadRecoveryLimit ?? process.env.MINUTE_FACT_DEAD_REQUEUE_LIMIT,
      100,
      1,
      1000,
    ),
  };
}

async function loadMaintenanceStatus(db, collectorId = RUNTIME_MAINTENANCE_COLLECTOR_ID) {
  if (!db?.prepare) return null;
  const statement = db.prepare(`SELECT status,last_attempt_at,last_success_at
    FROM sh_collector_status WHERE collector_id=? LIMIT 1`).bind(collectorId);
  if (typeof statement?.first !== 'function') return null;
  return statement.first();
}

function recentSuccessfulMaintenance(row, startedAt, minimumIntervalMs) {
  if (String(row?.status || '') !== 'ok') return false;
  const attemptAt = Number(row?.last_attempt_at);
  const successAt = Number(row?.last_success_at);
  const completedAt = Math.max(
    Number.isFinite(attemptAt) && attemptAt > 0 ? attemptAt : 0,
    Number.isFinite(successAt) && successAt > 0 ? successAt : 0,
  );
  return completedAt > 0
    && startedAt - completedAt >= 0
    && startedAt - completedAt < minimumIntervalMs;
}

async function writeMaintenanceStatus(db, {
  collectorId = RUNTIME_MAINTENANCE_COLLECTOR_ID,
  status,
  attemptAt,
  successAt = null,
  error = null,
  failureCode = null,
  failureStage = null,
  failureSummary = null,
  failureHint = null,
  updatedAt,
}) {
  if (!db?.prepare) throw new Error('OTHER_DB binding missing for runtime maintenance health');
  await db.prepare(`
    INSERT INTO sh_collector_status(
      collector_id,status,last_attempt_at,last_success_at,last_error,
      failure_code,failure_stage,failure_summary,failure_hint,updated_at
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
    ON CONFLICT(collector_id) DO UPDATE SET
      status=excluded.status,
      last_attempt_at=excluded.last_attempt_at,
      last_success_at=CASE
        WHEN excluded.last_success_at IS NOT NULL THEN excluded.last_success_at
        ELSE sh_collector_status.last_success_at
      END,
      last_error=excluded.last_error,
      failure_code=excluded.failure_code,
      failure_stage=excluded.failure_stage,
      failure_summary=excluded.failure_summary,
      failure_hint=excluded.failure_hint,
      updated_at=excluded.updated_at
  `).bind(
    collectorId,
    status,
    attemptAt,
    successAt,
    error,
    failureCode,
    failureStage,
    failureSummary,
    failureHint,
    updatedAt,
  ).run();
}

function skippedOfflineRebuildSummary(reason = 'rebuild-cadence') {
  return {
    event: 'offline_minute_rebuild_summary',
    skipped: true,
    reason,
    passes: 0,
    processed: 0,
    processed_rebuild: 0,
    processed_live: 0,
    failed: 0,
    dead: 0,
    skipped_budget: 0,
    duration_ms: 0,
    budget_exhausted: false,
  };
}

export async function runRuntimeOfflineMaintenanceActions(options = {}) {
  const clock = options.now || Date.now;
  const startedAt = Number(clock());
  if (!Number.isFinite(startedAt)) throw new Error('runtime offline maintenance start time is invalid');
  const deadline = startedAt + positiveInteger(
    process.env.RUNTIME_MAINTENANCE_DEADLINE_MS,
    12 * 60_000,
    60_000,
    14 * 60_000,
  );
  const env = options.env || productionEnvironment();
  const runInboxRecovery = options.runInboxRecovery || recoverStalledMinuteFactJobs;
  const runPrediction = options.runPrediction || runStreamGoalPrediction;
  const runRollup = options.runRollup || runRollupMaintenance;
  const runRebuilds = options.runRebuilds || runOfflineMinuteRebuilds;
  const runRetention = options.runRetention || pruneOldSnapshots;
  const lightOnly = options.lightOnly === true || enabled(process.env.RUNTIME_MAINTENANCE_LIGHT_ONLY);
  const rebuildOnly = options.rebuildOnly === true || enabled(process.env.RUNTIME_MAINTENANCE_REBUILD_ONLY);
  const skipRebuild = options.skipRebuild === true || enabled(process.env.RUNTIME_MAINTENANCE_SKIP_REBUILD);
  const force = options.force === true || enabled(process.env.RUNTIME_MAINTENANCE_FORCE);
  const minimumIntervalMs = positiveInteger(
    options.minimumIntervalMs ?? process.env.RUNTIME_MAINTENANCE_MIN_INTERVAL_MS,
    RUNTIME_MAINTENANCE_MIN_INTERVAL_MS,
    0,
    30 * 60_000,
  );
  const rebuildMinimumIntervalMs = positiveInteger(
    options.rebuildMinimumIntervalMs ?? process.env.OFFLINE_REBUILD_MIN_INTERVAL_MS,
    OFFLINE_REBUILD_MIN_INTERVAL_MS,
    0,
    24 * 60 * 60_000,
  );
  const readMaintenanceStatus = options.loadMaintenanceStatus || loadMaintenanceStatus;
  const readRebuildStatus = options.loadRebuildStatus
    || ((db) => loadMaintenanceStatus(db, OFFLINE_REBUILD_COLLECTOR_ID));
  const writeRebuildStatus = options.writeRebuildStatus
    || ((db, value) => writeMaintenanceStatus(db, {
      collectorId: OFFLINE_REBUILD_COLLECTOR_ID,
      ...value,
    }));
  if (minimumIntervalMs > 0 && !force) {
    const previous = await readMaintenanceStatus(env.OTHER_DB);
    if (recentSuccessfulMaintenance(previous, startedAt, minimumIntervalMs)) {
      return {
        ok: true,
        skipped: true,
        event: 'runtime_offline_maintenance_actions_coalesced',
        reason: 'recent-success',
        elapsed_ms: 0,
        last_success_preserved: true,
      };
    }
  }
  const ensureTime = () => {
    if (Number(clock()) >= deadline) {
      throw new Error('runtime offline maintenance deadline exceeded');
    }
  };

  const runRebuildPhase = async () => {
    if (skipRebuild) return skippedOfflineRebuildSummary('separate-integrity-repair');
    const previousRebuild = rebuildMinimumIntervalMs > 0 && options.forceRebuild !== true
      ? await readRebuildStatus(env.OTHER_DB)
      : null;
    if (rebuildMinimumIntervalMs > 0
        && options.forceRebuild !== true
        && recentSuccessfulMaintenance(previousRebuild, startedAt, rebuildMinimumIntervalMs)) {
      return skippedOfflineRebuildSummary();
    }
    const rebuilds = await runRebuilds(env, {
      now: clock,
      maxJobs: 1,
      maxPasses: 1,
      totalBudgetMs: 60_000,
    });
    const rebuildFinishedAt = timestamp(clock, startedAt);
    await writeRebuildStatus(env.OTHER_DB, {
      status: 'ok',
      attemptAt: startedAt,
      successAt: rebuildFinishedAt,
      updatedAt: rebuildFinishedAt,
    });
    return rebuilds;
  };

  await writeMaintenanceStatus(env.OTHER_DB, {
    status: 'running',
    attemptAt: startedAt,
    updatedAt: startedAt,
  });

  try {
    ensureTime();
    const inboxRecovery = await runInboxRecovery(
      env,
      inboxRecoveryOptions(options, startedAt),
    );
    ensureTime();

    if (rebuildOnly) {
      const rebuilds = await runRebuildPhase();
      const finishedAt = timestamp(clock, startedAt);
      await writeMaintenanceStatus(env.OTHER_DB, {
        status: 'ok',
        attemptAt: startedAt,
        successAt: finishedAt,
        updatedAt: finishedAt,
      });
      return {
        ok: true,
        event: 'runtime_rebuild_maintenance_actions_complete',
        elapsed_ms: Math.max(0, finishedAt - startedAt),
        inbox_recovery: inboxRecovery,
        rebuilds,
      };
    }

    const prediction = await runPrediction(env, startedAt);
    ensureTime();

    if (lightOnly) {
      const finishedAt = timestamp(clock, startedAt);
      await writeMaintenanceStatus(env.OTHER_DB, {
        status: 'ok',
        attemptAt: startedAt,
        successAt: finishedAt,
        updatedAt: finishedAt,
      });
      return {
        ok: true,
        event: 'runtime_light_maintenance_actions_complete',
        elapsed_ms: Math.max(0, finishedAt - startedAt),
        inbox_recovery: inboxRecovery,
        prediction,
      };
    }

    const rollup = await runRollup(env.BUDDIES_DB, env.OTHER_DB, env.MINUTE_DB, startedAt);
    ensureTime();
    const rebuilds = await runRebuildPhase();
    ensureTime();
    const retention = await runRetention(env, startedAt);
    const finishedAt = timestamp(clock, startedAt);

    await writeMaintenanceStatus(env.OTHER_DB, {
      status: 'ok',
      attemptAt: startedAt,
      successAt: finishedAt,
      updatedAt: finishedAt,
    });

    return {
      ok: true,
      event: 'runtime_offline_maintenance_actions_complete',
      elapsed_ms: Math.max(0, finishedAt - startedAt),
      inbox_recovery: inboxRecovery,
      prediction,
      rollup,
      rebuilds,
      retention,
    };
  } catch (error) {
    const failedAt = timestamp(clock, startedAt);
    const message = errorText(error);
    try {
      await writeMaintenanceStatus(env.OTHER_DB, {
        status: 'error',
        attemptAt: startedAt,
        error: message,
        failureCode: 'runtime_offline_maintenance_failed',
        failureStage: 'offline-maintenance',
        failureSummary: message,
        failureHint: 'Inspect the runtime maintenance workflow log.',
        updatedAt: failedAt,
      });
    } catch (statusError) {
      console.error(JSON.stringify({
        event: 'runtime_offline_maintenance_status_failed',
        error: errorText(statusError),
      }));
    }
    throw error;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runRuntimeOfflineMaintenanceActions()));
}
