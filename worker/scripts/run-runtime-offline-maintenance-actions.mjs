import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { runOfflineMinuteRebuilds } from '../src/minute-offline-rebuild.js';
import { runRollupMaintenance } from '../src/rollup-maintenance-coordinator.js';
import { pruneOldSnapshots } from '../src/snapshot-retention.js';
import { runStreamGoalPrediction } from '../src/stream-goal-prediction.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
const RUNTIME_MAINTENANCE_COLLECTOR_ID = 'other-cron';
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
    SNAPSHOT_RETENTION_INTERVAL_MS: 6 * 60 * 60_000,
    SNAPSHOT_RETENTION_BATCH_SIZE: 5000,
    SNAPSHOT_RETENTION_MAX_BATCHES: 100,
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

function explicitFalse(value) {
  return value === false
    || value === 0
    || /^(0|false|no|off)$/i.test(String(value ?? '').trim());
}

function optionalMetric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function d1BudgetSkip(options = {}) {
  const allowed = options.d1Allowed ?? process.env.RUNTIME_MAINTENANCE_D1_ALLOWED;
  if (!explicitFalse(allowed)) return null;
  return {
    reason: String(
      options.d1SkipReason
      ?? process.env.RUNTIME_MAINTENANCE_D1_SKIP_REASON
      ?? 'budget-exceeded',
    ).slice(0, 120),
    rows_read: optionalMetric(
      options.d1RowsRead ?? process.env.RUNTIME_MAINTENANCE_D1_ROWS_READ,
    ),
    read_limit: optionalMetric(
      options.d1ReadLimit ?? process.env.RUNTIME_MAINTENANCE_D1_READ_LIMIT,
    ),
    rows_written: optionalMetric(
      options.d1RowsWritten ?? process.env.RUNTIME_MAINTENANCE_D1_ROWS_WRITTEN,
    ),
    write_limit: optionalMetric(
      options.d1WriteLimit ?? process.env.RUNTIME_MAINTENANCE_D1_WRITE_LIMIT,
    ),
  };
}

async function writeMaintenanceStatus(db, {
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
    RUNTIME_MAINTENANCE_COLLECTOR_ID,
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
  const runPrediction = options.runPrediction || runStreamGoalPrediction;
  const runRollup = options.runRollup || runRollupMaintenance;
  const runRebuilds = options.runRebuilds || runOfflineMinuteRebuilds;
  const runRetention = options.runRetention || pruneOldSnapshots;
  const ensureTime = () => {
    if (Number(clock()) >= deadline) {
      throw new Error('runtime offline maintenance deadline exceeded');
    }
  };

  const budget = d1BudgetSkip(options);
  if (budget) {
    const finishedAt = timestamp(clock, startedAt);
    await writeMaintenanceStatus(env.OTHER_DB, {
      status: 'ok',
      attemptAt: startedAt,
      successAt: finishedAt,
      updatedAt: finishedAt,
    });
    return {
      ok: true,
      skipped: true,
      event: 'runtime_offline_maintenance_actions_budget_skipped',
      reason: 'd1-actions-budget',
      elapsed_ms: Math.max(0, finishedAt - startedAt),
      budget,
    };
  }

  await writeMaintenanceStatus(env.OTHER_DB, {
    status: 'running',
    attemptAt: startedAt,
    updatedAt: startedAt,
  });

  try {
    ensureTime();
    const prediction = await runPrediction(env, startedAt);
    ensureTime();
    const rollup = await runRollup(env.BUDDIES_DB, env.OTHER_DB, env.MINUTE_DB, startedAt);
    ensureTime();
    const rebuilds = await runRebuilds(env, { now: clock });
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
