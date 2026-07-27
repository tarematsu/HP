import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimOfflineRebuildJobs,
  OFFLINE_MINUTE_REBUILD_POLICY,
  runOfflineMinuteRebuilds,
} from '../src/minute-offline-rebuild.js';

function rebuildClaimDb(rows = []) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      const record = { sql, values: [] };
      statements.push(record);
      return {
        bind(...values) {
          record.values = values;
          return this;
        },
        async run() { return { meta: { changes: 0 } }; },
        async all() { return { results: rows }; },
      };
    },
  };
}

test('offline claims release and select rebuild jobs only with bounded indexed queries', async () => {
  const db = rebuildClaimDb([{ id: 7, job_kind: 'rebuild' }]);
  const jobs = await claimOfflineRebuildJobs({ MINUTE_DB: db }, {
    now: 1_000,
    limit: 5,
    leaseMs: 60_000,
  });

  assert.deepEqual(jobs, [{ id: 7, job_kind: 'rebuild' }]);
  assert.equal(db.statements.length, 2);
  assert.match(db.statements[0].sql, /idx_sh_minute_fact_jobs_processing_lease/);
  assert.match(db.statements[0].sql, /job_kind='rebuild'/);
  assert.deepEqual(db.statements[0].values, [1_000, 1_000, 5]);
  assert.match(db.statements[1].sql, /idx_sh_minute_fact_jobs_pending_ready/);
  assert.match(db.statements[1].sql, /job_kind='rebuild'/);
  assert.doesNotMatch(db.statements[1].sql, /job_kind='live'|job_kind!=/);
  assert.deepEqual(db.statements[1].values, [61_000, 1_000, 1_000, 5]);
});

test('offline rebuild runner keeps live work out and exposes the source DB alias', async () => {
  const buddiesDb = { name: 'buddies' };
  const minuteDb = { name: 'minute' };
  const customClaim = async () => [];
  const result = await runOfflineMinuteRebuilds({
    BUDDIES_DB: buddiesDb,
    MINUTE_DB: minuteDb,
  }, {
    maxJobs: 12,
    leaseMs: 90_000,
    runBudgetMs: 20_000,
    claim: customClaim,
    async run(env, dependencies) {
      assert.equal(env.DB, buddiesDb);
      assert.equal(env.MINUTE_DB, minuteDb);
      assert.equal(env.DERIVE_MAX_JOBS, 12);
      assert.equal(env.DERIVE_LEASE_MS, 90_000);
      assert.equal(env.DERIVE_RUN_BUDGET_MS, 20_000);
      assert.equal(dependencies.claim, customClaim);
      return { processed_rebuild: 3, processed_live: 0 };
    },
  });
  assert.deepEqual(result, { processed_rebuild: 3, processed_live: 0 });
});

test('offline rebuild policy is bounded and rebuild-only', () => {
  assert.equal(OFFLINE_MINUTE_REBUILD_POLICY.job_kind, 'rebuild');
  assert.equal(OFFLINE_MINUTE_REBUILD_POLICY.max_jobs, 50);
  assert.equal(OFFLINE_MINUTE_REBUILD_POLICY.run_budget_ms, 55_000);
});
