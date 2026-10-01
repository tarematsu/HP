import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runRuntimeOfflineMaintenanceActions } from '../worker/scripts/run-runtime-offline-maintenance-actions.mjs';

const workflow = readFileSync(new URL('../.github/workflows/run-runtime-offline-maintenance.yml', import.meta.url), 'utf8');
const dataRepairWorkflow = readFileSync(new URL('../.github/workflows/run-data-integrity-repair.yml', import.meta.url), 'utf8');
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

test('thirty-minute Runtime is lightweight and heavy repair is four-hourly', () => {
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /cron: '11,41 \* \* \* \*'/);
  assert.match(workflow, /RUNTIME_MAINTENANCE_LIGHT_ONLY: 'true'/);
  assert.doesNotMatch(workflow, /run-minute-facts-gap-scan-actions\.mjs/);
  assert.doesNotMatch(workflow, /worker\/src\/rollup-\*\*/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /run-runtime-offline-maintenance-actions\.mjs/);

  assert.match(dataRepairWorkflow, /cron: '31 \*\/4 \* \* \*'/);
  assert.match(dataRepairWorkflow, /run-minute-facts-gap-scan-actions\.mjs/);
  assert.match(dataRepairWorkflow, /publish-recent-daily-summaries-actions\.mjs/);
  assert.match(dataRepairWorkflow, /run-runtime-offline-maintenance-actions\.mjs/);
  assert.match(dataRepairWorkflow, /RUNTIME_MAINTENANCE_FORCE: 'true'/);

  assert.match(runner, /export async function runRuntimeOfflineMaintenanceActions/);
  assert.match(runner, /RUNTIME_MAINTENANCE_LIGHT_ONLY/);
  assert.match(runner, /RUNTIME_MAINTENANCE_FORCE/);
  assert.match(runner, /sh_collector_status/);
  assert.match(runner, /other-cron/);
  assert.match(runner, /minute-offline-rebuild-actions/);
  assert.match(runner, /OFFLINE_REBUILD_MIN_INTERVAL_MS = 4 \* 60 \* 60_000/);
});

test('runtime read-model maintenance has no D1 budget guard', () => {
  assert.doesNotMatch(workflow, /cloudflare-d1-write-guard\.mjs/);
  assert.doesNotMatch(dataRepairWorkflow, /cloudflare-d1-write-guard\.mjs/);
  assert.doesNotMatch(runner, /d1BudgetSkip|runtime_offline_maintenance_actions_budget_skipped|d1-budget-guard/);
});

test('lightweight mode stops after inbox recovery and prediction', async () => {
  const writes = [];
  const calls = [];
  const now = 1_000;
  const result = await runRuntimeOfflineMaintenanceActions({
    now: () => now,
    lightOnly: true,
    env: { BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: statusDatabase(writes) },
    runInboxRecovery: async () => { calls.push('inbox'); return 'inbox'; },
    runPrediction: async () => { calls.push('prediction'); return 'prediction'; },
    runRollup: async () => assert.fail('rollup must not run in lightweight mode'),
    runRebuilds: async () => assert.fail('rebuild must not run in lightweight mode'),
    runRetention: async () => assert.fail('retention must not run in lightweight mode'),
  });

  assert.deepEqual(calls, ['inbox', 'prediction']);
  assert.deepEqual(writes.map(({ values }) => values[1]), ['running', 'ok']);
  assert.deepEqual(result, {
    ok: true,
    event: 'runtime_light_maintenance_actions_complete',
    elapsed_ms: 0,
    inbox_recovery: 'inbox',
    prediction: 'prediction',
  });
});

test('recent successful attempt coalesces before any work', async () => {
  const writes = [];
  const calls = [];
  const now = 2_000_000;
  const result = await runRuntimeOfflineMaintenanceActions({
    now: () => now,
    env: { BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: statusDatabase(writes) },
    loadMaintenanceStatus: async () => ({
      status: 'ok',
      last_attempt_at: now - 30_000,
      last_success_at: now - 60 * 60_000,
    }),
    runInboxRecovery: async () => { calls.push('inbox'); },
    runPrediction: async () => { calls.push('prediction'); },
    runRollup: async () => { calls.push('rollup'); },
    runRebuilds: async () => { calls.push('rebuilds'); },
    runRetention: async () => { calls.push('retention'); },
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(writes, []);
  assert.equal(result.event, 'runtime_offline_maintenance_actions_coalesced');
  assert.equal(result.reason, 'recent-success');
});

test('force bypasses coalescing for the four-hour integrity lane', async () => {
  const writes = [];
  const calls = [];
  const now = 2_000_000;
  await runRuntimeOfflineMaintenanceActions({
    now: () => now,
    force: true,
    env: { BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: statusDatabase(writes) },
    loadMaintenanceStatus: async () => ({ status: 'ok', last_attempt_at: now - 30_000, last_success_at: now - 30_000 }),
    runInboxRecovery: async () => { calls.push('inbox'); return 'inbox'; },
    runPrediction: async () => { calls.push('prediction'); return 'prediction'; },
    runRollup: async () => { calls.push('rollup'); return 'rollup'; },
    runRebuilds: async () => { calls.push('rebuilds'); return 'rebuilds'; },
    runRetention: async () => { calls.push('retention'); return 'retention'; },
  });
  assert.deepEqual(calls, ['inbox', 'prediction', 'rollup', 'rebuilds', 'retention']);
});

test('Actions reconciles the minute inbox before heavy database maintenance', async () => {
  const calls = [];
  const writes = [];
  const now = 1_000;
  const buddiesDb = { name: 'buddies' };
  const minuteDb = { name: 'minute' };
  const otherDb = statusDatabase(writes);
  const inboxRecovery = {
    processed: 3,
    finalized_count: 3,
    released_count: 0,
    requeued_count: 0,
    pending_count: 0,
  };
  const result = await runRuntimeOfflineMaintenanceActions({
    now: () => now,
    env: { BUDDIES_DB: buddiesDb, MINUTE_DB: minuteDb, OTHER_DB: otherDb },
    runInboxRecovery: async (env, options) => {
      calls.push('inbox-recovery');
      assert.equal(env.MINUTE_DB, minuteDb);
      assert.deepEqual(options, { now, limit: 1000, deadLimit: 100 });
      return inboxRecovery;
    },
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
      assert.equal(dependencies.maxJobs, 1);
      assert.equal(dependencies.maxPasses, 1);
      assert.equal(dependencies.totalBudgetMs, 60_000);
      return 'rebuilds';
    },
    runRetention: async () => { calls.push('retention'); return 'retention'; },
  });

  assert.deepEqual(calls, ['inbox-recovery', 'prediction', 'rollup', 'rebuilds', 'retention']);
  assert.deepEqual(writes.map(({ values }) => values[1]), ['running', 'ok', 'ok']);
  assert.equal(writes[0].values[0], 'other-cron');
  assert.equal(writes[1].values[0], 'minute-offline-rebuild-actions');
  assert.deepEqual(result, {
    ok: true,
    event: 'runtime_offline_maintenance_actions_complete',
    elapsed_ms: 0,
    inbox_recovery: inboxRecovery,
    prediction: 'prediction',
    rollup: 'rollup',
    rebuilds: 'rebuilds',
    retention: 'retention',
  });
  assert.match(runner, /SNAPSHOT_RETENTION_INTERVAL_MS: 24 \* 60 \* 60_000/);
  assert.match(runner, /SNAPSHOT_RETENTION_BATCH_SIZE: 500/);
  assert.match(runner, /SNAPSHOT_RETENTION_MAX_BATCHES: 1/);
  assert.match(runner, /STREAM_GOAL_PREDICTION_INTERVAL_MS: 30 \* 60_000/);
});

test('offline rebuild remains independently limited to four hours', async () => {
  const calls = [];
  const writes = [];
  const now = 20 * 60 * 60_000;
  const result = await runRuntimeOfflineMaintenanceActions({
    now: () => now,
    env: { BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: statusDatabase(writes) },
    loadRebuildStatus: async () => ({
      status: 'ok',
      last_attempt_at: now - 60 * 60_000,
      last_success_at: now - 60 * 60_000,
    }),
    runInboxRecovery: async () => { calls.push('inbox'); return 'inbox'; },
    runPrediction: async () => { calls.push('prediction'); return 'prediction'; },
    runRollup: async () => { calls.push('rollup'); return 'rollup'; },
    runRebuilds: async () => assert.fail('rebuilds must wait for the four-hour cadence'),
    runRetention: async () => { calls.push('retention'); return 'retention'; },
  });

  assert.deepEqual(calls, ['inbox', 'prediction', 'rollup', 'retention']);
  assert.equal(result.rebuilds.skipped, true);
  assert.equal(result.rebuilds.reason, 'rebuild-cadence');
});

test('legacy budget inputs cannot defer repair', async () => {
  const calls = [];
  const writes = [];
  const result = await runRuntimeOfflineMaintenanceActions({
    now: () => 2_000,
    d1Allowed: false,
    d1SkipReason: 'projected-read-budget-exceeded',
    env: { BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: statusDatabase(writes) },
    runInboxRecovery: async () => { calls.push('inbox'); return 'inbox'; },
    runPrediction: async () => { calls.push('prediction'); return 'prediction'; },
    runRollup: async () => { calls.push('rollup'); return 'rollup'; },
    runRebuilds: async () => { calls.push('rebuilds'); return 'rebuilds'; },
    runRetention: async () => { calls.push('retention'); return 'retention'; },
  });

  assert.deepEqual(calls, ['inbox', 'prediction', 'rollup', 'rebuilds', 'retention']);
});

test('Actions persists runtime maintenance failures for public health', async () => {
  const writes = [];
  await assert.rejects(
    runRuntimeOfflineMaintenanceActions({
      now: () => 2_000,
      env: { BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: statusDatabase(writes) },
      runInboxRecovery: async () => ({ processed: 0 }),
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
