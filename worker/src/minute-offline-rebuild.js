import { runMinuteFactDeriveCron } from './minute-facts-derive.js';

const DEFAULT_MAX_JOBS = 50;
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_RUN_BUDGET_MS = 55_000;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = integer(value);
  if (parsed == null || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export async function claimOfflineRebuildJobs(env, options = {}) {
  const db = env?.MINUTE_DB;
  if (!db?.prepare) throw new Error('offline minute rebuild MINUTE_DB binding is missing');
  const now = integer(options.now) ?? Date.now();
  const limit = positiveInteger(options.limit, 1, 100);
  const leaseMs = positiveInteger(options.leaseMs, DEFAULT_LEASE_MS, 10 * 60_000);

  await db.prepare(`UPDATE sh_minute_fact_jobs SET
      status='pending',next_attempt_at=0,lease_until=NULL,updated_at=?
    WHERE id IN (
      SELECT id FROM sh_minute_fact_jobs INDEXED BY idx_sh_minute_fact_jobs_processing_lease
      WHERE status='processing' AND job_kind='rebuild' AND COALESCE(lease_until,0)<?
      ORDER BY lease_until ASC,id ASC LIMIT ?
    )`).bind(now, now, limit).run();

  const claimed = await db.prepare(`UPDATE sh_minute_fact_jobs SET
      status='processing',attempts=attempts+1,lease_until=?,updated_at=?
    WHERE id IN (
      SELECT id FROM sh_minute_fact_jobs INDEXED BY idx_sh_minute_fact_jobs_pending_ready
      WHERE status='pending' AND next_attempt_at<=? AND job_kind='rebuild'
      ORDER BY next_attempt_at ASC,job_priority DESC,minute_at ASC,id ASC
      LIMIT ?
    )
    RETURNING *`).bind(now + leaseMs, now, now, limit).all();
  return claimed.results || [];
}

function offlineRebuildEnvironment(env, options = {}) {
  const active = Object.create(env || null);
  Object.defineProperties(active, {
    DB: {
      value: env?.DB || env?.BUDDIES_DB || null,
      enumerable: true,
      configurable: true,
    },
    DERIVE_MAX_JOBS: {
      value: positiveInteger(options.maxJobs, DEFAULT_MAX_JOBS, 100),
      enumerable: true,
      configurable: true,
    },
    DERIVE_LEASE_MS: {
      value: positiveInteger(options.leaseMs, DEFAULT_LEASE_MS, 10 * 60_000),
      enumerable: true,
      configurable: true,
    },
    DERIVE_RUN_BUDGET_MS: {
      value: positiveInteger(options.runBudgetMs, DEFAULT_RUN_BUDGET_MS, 55_000),
      enumerable: true,
      configurable: true,
    },
  });
  return active;
}

export async function runOfflineMinuteRebuilds(env, dependencies = {}) {
  const run = dependencies.run || runMinuteFactDeriveCron;
  const active = offlineRebuildEnvironment(env, dependencies);
  return run(active, {
    ...dependencies,
    claim: dependencies.claim || claimOfflineRebuildJobs,
  });
}

export const OFFLINE_MINUTE_REBUILD_POLICY = Object.freeze({
  job_kind: 'rebuild',
  max_jobs: DEFAULT_MAX_JOBS,
  lease_ms: DEFAULT_LEASE_MS,
  run_budget_ms: DEFAULT_RUN_BUDGET_MS,
});
