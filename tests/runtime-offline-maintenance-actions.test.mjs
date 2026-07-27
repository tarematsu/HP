import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runRuntimeOfflineMaintenanceActions } from '../worker/scripts/run-runtime-offline-maintenance-actions.mjs';

const workflow = readFileSync(new URL('../.github/workflows/run-runtime-offline-maintenance.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../worker/scripts/run-runtime-offline-maintenance-actions.mjs', import.meta.url), 'utf8');
const deployed = readFileSync(new URL('../worker/src/runtime-orchestrator-deployed-entry.js', import.meta.url), 'utf8');
const runtime = JSON.parse(readFileSync(new URL('../worker/wrangler.runtime.jsonc', import.meta.url), 'utf8'));

function statusDatabase(writes) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              writes.push({ sql, values });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

test('offline runtime maintenance runs frequently and after production deploys', () => {
  assert.match(workflow, /workflows: \["Deploy production"\]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
  assert.match(workflow, /cron: '7,37 \* \* \* \*'/);
  assert.match(workflow, /worker\/src\/minute-\*\*/);
  assert.match(workflow, /worker\/src\/rollup-\*\*/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /run-runtime-offline-maintenance-actions\.mjs/);
  assert.match(runner, /export async function runRuntimeOfflineMaintenanceActions/);
  assert.match(runner, /runtime offline maintenance deadline exceeded/);
  assert.match(runner, /sh_collector_status/);
  assert.match(runner, /other-cron/);
  assert.match(runner, /runRollup\(env\.BUDDIES_DB, env\.OTHER_DB, env\.MINUTE_DB, startedAt\)/);
  assert.match(runner, /runOfflineMinuteRebuilds/);
});

test('offline runtime maintenance is protected by daily read and hourly write budgets', () => {
  assert.match(workflow, /D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT: '4000'/);
  assert.match(workflow, /D1_ACTIONS_READ_ROWS_PER_DAY_LIMIT: '3500000'/);
  assert.match(workflow, /id: d1-budget/);
  assert.match(workflow, /RUNTIME_MAINTENANCE_D1_ALLOWED/);
  assert.match(runner, /runtime_offline_maintenance_actions_budget_skipped/);
});

test('Actions connects BUDDIES, MINUTE, and OTHER databases in order', async () => {
  const calls = [];
  const writes = [];
  const now = 1_000;
  const buddiesDb = { name: 'buddies' };
  const minuteDb = { name: 'minute' };
  const otherDb = statusDatabase(writes);
  const result = await runRuntimeOfflineMaintenanceActions({
    now: () => now,
    env: { BUDDIES_DB: buddiesDb, MINUTE_DB: minuteDb, OTHER_DB: otherDb },
    runPrediction: async () => { calls.push('prediction'); return 'prediction'; },
    runRollup: async (...args) => {
      calls.push('rollup');
      assert.deepEqual(args, [buddiesDb, otherDb, minuteDb, now]);
      return 'rollup';
    },
    runRebuilds: async (env, dependencies) => {
      calls.push('rebuilds');
      assert.equal(env.BUDDIES_DB, buddiesDb);
      assert.equal(env.MINUTE_DB, minuteDb);
      assert.equal(dependencies.now(), now);
      return 'rebuilds';
    },
    runRetention: async () => { calls.push('retention'); return 'retention'; },
  });

  assert.deepEqual(calls, ['prediction', 'rollup', 'rebuilds', 'retention']);
  assert.deepEqual(writes.map(({ values }) => values[1]), ['running', 'ok']);
  assert.equal(writes[0].values[0], 'other-cron');
  assert.equal(writes[1].values[3], now);
  assert.match(writes[0].sql, /ON CONFLICT\(collector_id\)/);
  assert.deepEqual(result, {
    ok: true,
    event: 'runtime_offline_maintenance_actions_complete',
    elapsed_ms: 0,
    prediction: 'prediction',
    rollup: 'rollup',
    rebuilds: 'rebuilds',
    retention: 'retention',
  });
  assert.match(runner, /SNAPSHOT_RETENTION_BATCH_SIZE: 5000/);
  assert.match(runner, /SNAPSHOT_RETENTION_MAX_BATCHES: 100/);
  assert.match(runner, /STREAM_GOAL_PREDICTION_INTERVAL_MS: 30 \* 60_000/);
});

test('budget pressure records a healthy skip without running D1-heavy tasks', async () => {
  const writes = [];
  const fail = async () => assert.fail('D1-heavy maintenance must not run');
  const result = await runRuntimeOfflineMaintenanceActions({
    now: () => 2_000,
    d1Allowed: false,
    d1SkipReason: 'read-budget-exceeded',
    d1RowsRead: 4_200_000,
    d1ReadLimit: 3_500_000,
    d1RowsWritten: 100,
    d1WriteLimit: 4_000,
    env: { BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: statusDatabase(writes) },
    runPrediction: fail,
    runRollup: fail,
    runRebuilds: fail,
    runRetention: fail,
  });

  assert.deepEqual(writes.map(({ values }) => values[1]), ['ok']);
  assert.deepEqual(result, {
    ok: true,
    skipped: true,
    event: 'runtime_offline_maintenance_actions_budget_skipped',
    reason: 'd1-actions-budget',
    elapsed_ms: 0,
    budget: {
      reason: 'read-budget-exceeded',
      rows_read: 4_200_000,
      read_limit: 3_500_000,
      rows_written: 100,
      write_limit: 4_000,
    },
  });
});

test('Actions persists runtime maintenance failures for public health', async () => {
  const writes = [];
  await assert.rejects(
    runRuntimeOfflineMaintenanceActions({
      now: () => 2_000,
      env: { BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: statusDatabase(writes) },
      runPrediction: async () => { throw new Error('prediction failed'); },
      runRollup: async () => assert.fail('rollup must not run'),
      runRebuilds: async () => assert.fail('rebuilds must not run'),
      runRetention: async () => assert.fail('retention must not run'),
    }),
    /prediction failed/,
  );

  assert.deepEqual(writes.map(({ values }) => values[1]), ['running', 'error']);
  assert.equal(writes[1].values[4], 'prediction failed');
  assert.equal(writes[1].values[5], 'runtime_offline_maintenance_failed');
  assert.equal(writes[1].values[6], 'offline-maintenance');
});

test('runtime deployment has no scheduled surface or offline relay queues', () => {
  assert.equal(runtime.triggers, undefined);
  assert.doesNotMatch(deployed, /scheduled\s*:|runRuntimeOrchestratorScheduled/);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue === 'stationhead-host-monitor'), false);
  assert.equal(runtime.queues.producers.some(({ binding }) => binding === 'HOST_MONITOR_QUEUE'), false);
});
