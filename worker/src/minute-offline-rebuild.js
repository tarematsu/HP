import { runMinuteFactDeriveCron } from './minute-facts-derive.js';

const DEFAULT_MAX_JOBS = 50;
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_RUN_BUDGET_MS = 55_000;
const DEFAULT_MAX_PASSES = 6;
const DEFAULT_TOTAL_BUDGET_MS = 6 * 60_000;
const DEADLINE_GUARD_MS = 1_000;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = integer(value);
  if (parsed == null || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
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
      value: positiveInteger(options.runBudgetMs, DEFAULT_RUN_BUDGET_MS, DEFAULT_RUN_BUDGET_MS),
      enumerable: true,
      configurable: true,
    },
  });
  return active;
}

function mergePassSummary(summary, result = {}) {
  summary.processed += count(result.processed);
  summary.processed_rebuild += count(result.processed_rebuild);
  summary.processed_live += count(result.processed_live);
  summary.failed += count(result.failed);
  summary.dead += count(result.dead);
  summary.skipped_budget += count(result.skipped_budget);
  for (const field of [
    'pending_count',
    'processing_count',
    'dead_count',
    'rebuild_pending_count',
    'live_pending_count',
    'oldest_pending_minute',
  ]) {
    if (Object.hasOwn(result, field)) summary[field] = result[field];
  }
}

export async function runOfflineMinuteRebuilds(env, dependencies = {}) {
  const run = dependencies.run || runMinuteFactDeriveCron;
  const nowFn = dependencies.now || Date.now;
  const startedAt = integer(nowFn()) ?? Date.now();
  const maxPasses = positiveInteger(dependencies.maxPasses, DEFAULT_MAX_PASSES, 10);
  const totalBudgetMs = positiveInteger(
    dependencies.totalBudgetMs,
    DEFAULT_TOTAL_BUDGET_MS,
    8 * 60_000,
  );
  const passBudgetMs = positiveInteger(
    dependencies.runBudgetMs,
    DEFAULT_RUN_BUDGET_MS,
    DEFAULT_RUN_BUDGET_MS,
  );
  const deadlineAt = startedAt + totalBudgetMs;
  const summary = {
    event: 'offline_minute_rebuild_summary',
    passes: 0,
    processed: 0,
    processed_rebuild: 0,
    processed_live: 0,
    failed: 0,
    dead: 0,
    skipped_budget: 0,
  };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const passStartedAt = integer(nowFn()) ?? startedAt;
    const remainingMs = deadlineAt - passStartedAt;
    if (remainingMs <= DEADLINE_GUARD_MS) break;
    const active = offlineRebuildEnvironment(env, {
      ...dependencies,
      runBudgetMs: Math.min(passBudgetMs, remainingMs - DEADLINE_GUARD_MS),
    });
    const result = await run(active, {
      ...dependencies,
      claim: dependencies.claim || claimOfflineRebuildJobs,
    });
    summary.passes += 1;
    mergePassSummary(summary, result);

    const handled = count(result?.processed)
      || count(result?.processed_rebuild) + count(result?.processed_live);
    if (handled === 0 && count(result?.failed) === 0) break;
  }

  const finishedAt = integer(nowFn()) ?? startedAt;
  summary.duration_ms = Math.max(0, finishedAt - startedAt);
  summary.budget_exhausted = finishedAt >= deadlineAt - DEADLINE_GUARD_MS;
  console.log(JSON.stringify(summary));
  return summary;
}

export const OFFLINE_MINUTE_REBUILD_POLICY = Object.freeze({
  job_kind: 'rebuild',
  max_jobs: DEFAULT_MAX_JOBS,
  lease_ms: DEFAULT_LEASE_MS,
  run_budget_ms: DEFAULT_RUN_BUDGET_MS,
  max_passes: DEFAULT_MAX_PASSES,
  total_budget_ms: DEFAULT_TOTAL_BUDGET_MS,
});
