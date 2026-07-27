import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runRuntimeOfflineMaintenanceActions } from '../worker/scripts/run-runtime-offline-maintenance-actions.mjs';

const workflow = readFileSync(new URL('../.github/workflows/run-runtime-offline-maintenance.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../worker/scripts/run-runtime-offline-maintenance-actions.mjs', import.meta.url), 'utf8');

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

test('offline runtime maintenance is protected by daily read and hourly write budgets', () => {
  assert.match(workflow, /cron: '7,37 \* \* \* \*'/);
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
    runRebuilds: async () => { calls.push('rebuilds'); return 'rebuilds'; },
    runRetention: async () => { calls.push('retention'); return 'retention'; },
  });

  assert.deepEqual(calls, ['prediction', 'rollup', 'rebuilds', 'retention']);
  assert.deepEqual(writes.map(({ values }) => values[1]), ['running', 'ok']);
  assert.equal(result.event, 'runtime_offline_maintenance_actions_complete');
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

  assert.deepEqual(writes.map(({ values }) => values[1]), ['running', 'ok']);
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
