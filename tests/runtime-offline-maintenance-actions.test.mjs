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

test('offline runtime maintenance runs on the thirty-minute cadence without deployment fan-out', () => {
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /workflows: \[[^\]]*Deploy production/);
  assert.match(workflow, /cron: '11,41 \* \* \* \*'/);
  assert.match(workflow, /worker\/src\/minute-\*\*/);
  assert.match(workflow, /worker\/src\/rollup-\*\*/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /run-runtime-offline-maintenance-actions\.mjs/);
  assert.match(runner, /export async function runRuntimeOfflineMaintenanceActions/);
  assert.match(runner, /runtime offline maintenance deadline exceeded/);
  assert.match(runner, /sh_collector_status/);
  assert.match(runner, /other-cron/);
  assert.match(runner, /minute-offline-rebuild-actions/);
  assert.match(runner, /OFFLINE_REBUILD_MIN_INTERVAL_MS = 4 \* 60 \* 60_000/);
  assert.match(runner, /recoverStalledMinuteFactJobs/);
  assert.match(runner, /runInboxRecovery/);
  assert.match(runner, /runRollup\(env\.BUDDIES_DB, env\.OTHER_DB, env\.MINUTE_DB, startedAt\)/);
  assert.match(runner, /runOfflineMinuteRebuilds/);
});

test('runtime read-model maintenance has no D1 budget guard', () => {
  assert.doesNotMatch(workflow, /cloudflare-d1-write-guard\.mjs/);
  assert.doesNotMatch(workflow, /D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT/);
  assert.doesNotMatch(workflow, /D1_ACTIONS_READ_ROWS_PER_DAY_LIMIT/);
  assert.doesNotMatch(workflow, /D1_ACTIONS_READ_PROJECTION_MINUTES/);
  assert.doesNotMatch(workflow, /id: d1-budget/);
  assert.doesNotMatch(workflow, /RUNTIME_MAINTENANCE_D1_ALLOWED/);
  assert.doesNotMatch(workflow, /Summarize D1 budget decision/);
  assert.doesNotMatch(runner, /d1BudgetSkip|runtime_offline_maintenance_actions_budget_skipped|d1-budget-guard/);
});

test('recent successful attempt coalesces even when the prior success is older', async () => {
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

test('recent successful maintenance coalesces duplicate chained runs before any writes', async () => {
  const writes = [];
  const calls = [];
  const now = 1_000_000;
  const result = await runRuntimeOfflineMaintenanceActions({
    now: () => now,
    env: { BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: statusDatabase(writes) },
    loadMaintenanceStatus: async () => ({
      status: 'ok',
      last_attempt_at: now - 60_000,
      last_success_at: now - 60_000,
    }),
    runInboxRecovery: async () => { calls.push('inbox'); },
    runPrediction: async () => { calls.push('prediction'); },
    runRollup: async () => { calls.push('rollup'); },
    runRebuilds: async () => { calls.push('rebuilds'); },
    runRetention: async () => { calls.push('retention'); },
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(writes, []);
  assert.deepEqual(result, {
    ok: true,
    skipped: true,
    event: 'runtime_offline_maintenance_actions_coalesced',
    reason: 'recent-success',
    elapsed_ms: 0,
    last_success_preserved: true,
  });
});

test('Actions reconciles the minute inbox before other database maintenance', async () => {
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
      assert.equal(dependencies.now(), now);
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
  assert.equal(writes[2].values[3], now);
  assert.match(writes[0].sql, /ON CONFLICT\(collector_id\)/);
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
  assert.match(runner, /SNAPSHOT_RETENTION_BATCH_SIZE: 500/);
  assert.match(runner, /SNAPSHOT_RETENTION_MAX_BATCHES: 1/);
  assert.match(runner, /STREAM_GOAL_PREDICTION_INTERVAL_MS: 30 \* 60_000/);
});

test('offline rebuild cadence does not slow the other thirty-minute maintenance tasks', async () => {
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
  assert.deepEqual(writes.map(({ values }) => values[1]), ['running', 'ok']);
  assert.equal(result.rebuilds.skipped, true);
  assert.equal(result.rebuilds.reason, 'rebuild-cadence');
  assert.equal(result.rebuilds.processed, 0);
});

test('legacy budget inputs cannot defer runtime read-model maintenance', async () => {
  const calls = [];
  const writes = [];
  const result = await runRuntimeOfflineMaintenanceActions({
    now: () => 2_000,
    d1Allowed: false,
    d1SkipReason: 'projected-read-budget-exceeded',
    d1RowsRead: 200_000,
    d1ProjectedRowsRead: 4_800_000,
    d1ReadLimit: 3_500_000,
    d1RowsWritten: 100,
    d1WriteLimit: 4_000,
    env: { BUDDIES_DB: {}, MINUTE_DB: {}, OTHER_DB: statusDatabase(writes) },
    runInboxRecovery: async () => { calls.push('inbox'); return 'inbox'; },
    runPrediction: async () => { calls.push('prediction'); return 'prediction'; },
    runRollup: async () => { calls.push('rollup'); return 'rollup'; },
    runRebuilds: async () => { calls.push('rebuilds'); return 'rebuilds'; },
    runRetention: async () => { calls.push('retention'); return 'retention'; },
  });

  assert.deepEqual(calls, ['inbox', 'prediction', 'rollup', 'rebuilds', 'retention']);
  assert.deepEqual(writes.map(({ values }) => values[1]), ['running', 'ok', 'ok']);
  assert.deepEqual(result, {
    ok: true,
    event: 'runtime_offline_maintenance_actions_complete',
    elapsed_ms: 0,
    inbox_recovery: 'inbox',
    prediction: 'prediction',
    rollup: 'rollup',
    rebuilds: 'rebuilds',
    retention: 'retention',
  });
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
