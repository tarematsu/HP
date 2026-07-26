import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  claimRuntimeD1Lease,
  runD1CoordinatedScheduled,
} from '../src/runtime-d1-coordinator.js';
import {
  runRuntimeOrchestratorScheduled,
  runtimeOrchestratorDue,
} from '../src/runtime-orchestrator-deployed-entry.js';

function leaseDb(results = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return this;
        },
        async first() {
          return results.shift() ?? null;
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

test('runtime claims and releases a D1 lease around one scheduled graph', async () => {
  const db = leaseDb([{ holder_id: 'holder-1', lease_until: 71_000 }]);
  const calls = [];
  const result = await runD1CoordinatedScheduled(
    { cron: '* * * * *', scheduledTime: 123 },
    { BUDDIES_DB: db },
    {},
    async () => {
      calls.push('run');
      return 'ok';
    },
    { now: 1_000, holderId: 'holder-1' },
  );
  assert.equal(result, 'ok');
  assert.deepEqual(calls, ['run']);
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /INSERT INTO sh_runtime_run_lease/);
  assert.match(db.calls[0].sql, /sh_runtime_run_lease\.ticket IS NOT excluded\.ticket/);
  assert.match(db.calls[1].sql, /UPDATE sh_runtime_run_lease/);
});

test('duplicate D1 lease skips and a failed graph retains its TTL', async () => {
  const duplicateDb = leaseDb([null]);
  const duplicate = await runD1CoordinatedScheduled(
    { cron: '* * * * *', scheduledTime: 123 },
    { BUDDIES_DB: duplicateDb },
    {},
    async () => assert.fail('duplicate graph must not run'),
    { now: 1_000, holderId: 'holder-1' },
  );
  assert.deepEqual(duplicate, {
    skipped: true,
    reason: 'runtime-d1-duplicate-or-active',
  });

  const failedDb = leaseDb([{ holder_id: 'holder-2', lease_until: 71_000 }]);
  await assert.rejects(runD1CoordinatedScheduled(
    { cron: '* * * * *', scheduledTime: 124 },
    { BUDDIES_DB: failedDb },
    {},
    async () => { throw new Error('graph failed'); },
    { now: 1_000, holderId: 'holder-2' },
  ), /graph failed/);
  assert.equal(failedDb.calls.length, 1);
});

test('missing lease migration fails open during rolling deployment', async () => {
  const errors = [];
  const original = console.error;
  console.error = (value) => errors.push(value);
  try {
    const result = await claimRuntimeD1Lease({
      BUDDIES_DB: {
        prepare() {
          return {
            bind() { return this; },
            async first() { throw new Error('no such table: sh_runtime_run_lease'); },
          };
        },
      },
    }, { cron: '* * * * *', scheduledTime: 123 }, { now: 1_000 });
    assert.equal(result.claimed, true);
    assert.equal(result.uncoordinated, true);
    assert.equal(result.reason, 'migration-missing');
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
});

test('Actions maintenance removes Worker recovery/rebuild/sync slots', async () => {
  const day = Date.UTC(2026, 0, 1);
  const env = {
    MINUTE_FACT_ACTIONS_MAINTENANCE_ENABLED: true,
    PAGES_TRACK_HISTORY_CYCLE_ENABLED: false,
  };
  let due = 0;
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    if (runtimeOrchestratorDue({
      cron: '* * * * *',
      scheduledTime: day + minute * 60_000,
    }, env)) due += 1;
  }
  assert.ok(due < 652);

  const idle = await runRuntimeOrchestratorScheduled(
    { cron: '* * * * *', scheduledTime: day + 2 * 60_000 },
    env,
    {},
  );
  assert.equal(idle.skipped, true);
  assert.equal(idle.reason, 'no-runtime-or-pages-task-due');
});

test('runtime config has only the collector DO and uses D1 maintenance flags', () => {
  const config = JSON.parse(readFileSync(
    new URL('../wrangler.runtime.jsonc', import.meta.url),
    'utf8',
  ));
  assert.equal(config.vars.MINUTE_FACT_ACTIONS_MAINTENANCE_ENABLED, true);
  assert.equal(config.vars.HISTORICAL_REBUILD_ENABLED, false);
  assert.equal(config.vars.REBUILD_HISTORICAL_BACKFILL_ENABLED, false);
  assert.equal(config.vars.REVISION_PROGRESS_R2_ENABLED, false);
  assert.deepEqual(config.durable_objects.bindings, [{
    name: 'BUDDIES_COLLECTOR_COORDINATOR',
    class_name: 'BuddiesCollectorCoordinator',
    script_name: 'sh-buddies-collector',
  }]);
  assert.equal('migrations' in config, false);
});
