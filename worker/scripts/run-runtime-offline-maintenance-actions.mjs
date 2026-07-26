import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { runRollupMaintenance } from '../src/rollup-maintenance.js';
import { pruneOldSnapshots } from '../src/snapshot-retention.js';
import { runStreamGoalPrediction } from '../src/stream-goal-prediction.js';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');
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
  const runRetention = options.runRetention || pruneOldSnapshots;
  const ensureTime = () => {
    if (Number(clock()) >= deadline) {
      throw new Error('runtime offline maintenance deadline exceeded');
    }
  };

  ensureTime();
  const prediction = await runPrediction(env, startedAt);
  ensureTime();
  const rollup = await runRollup(env.BUDDIES_DB, env.OTHER_DB, null, startedAt);
  ensureTime();
  const retention = await runRetention(env, startedAt);

  return {
    ok: true,
    event: 'runtime_offline_maintenance_actions_complete',
    elapsed_ms: Math.max(0, Number(clock()) - startedAt),
    prediction,
    rollup,
    retention,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runRuntimeOfflineMaintenanceActions()));
}
