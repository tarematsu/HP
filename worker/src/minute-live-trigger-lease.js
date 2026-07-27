import {
  claimCoordinatedLiveJob,
  releaseCoordinatedLiveJobs,
} from './minute-live-job-coordinator.js';

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = integer(value);
  if (parsed == null || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

async function claimD1LiveDeriveJob(env, trigger, options = {}) {
  const db = env?.MINUTE_DB;
  if (!db?.prepare) throw new Error('minute live derive MINUTE_DB binding is missing');
  const now = integer(options.now) ?? Date.now();
  const leaseMs = positiveInteger(options.leaseMs, 60_000, 10 * 60_000);
  const jobKind = String(trigger?.job_kind || 'live');
  const result = await db.prepare(`UPDATE sh_minute_fact_jobs SET
      status='processing',attempts=attempts+1,lease_until=?,updated_at=?
    WHERE channel_id=? AND minute_at=? AND job_kind=? AND (
      (status='pending' AND next_attempt_at<=?)
      OR (status='processing' AND COALESCE(lease_until,0)<?)
    )
    RETURNING *`)
    .bind(
      now + leaseMs,
      now,
      integer(trigger?.channel_id),
      integer(trigger?.minute_at),
      jobKind,
      now,
      now,
    )
    .all();
  return result.results?.[0] || null;
}

async function releaseD1LiveDeriveJobs(env, jobIds, options = {}) {
  const ids = (Array.isArray(jobIds) ? jobIds : [jobIds])
    .map((value) => integer(value))
    .filter((value) => value != null && value > 0);
  if (!ids.length) return { released: 0 };
  const db = env?.MINUTE_DB;
  if (!db?.prepare) throw new Error('minute live derive MINUTE_DB binding is missing');
  const now = integer(options.now) ?? Date.now();
  const placeholders = ids.map(() => '?').join(',');
  const result = await db.prepare(`UPDATE sh_minute_fact_jobs SET
      status='pending',attempts=MAX(0,attempts-1),next_attempt_at=0,
      lease_until=NULL,updated_at=?
    WHERE status='processing' AND id IN (${placeholders})`)
    .bind(now, ...ids)
    .run();
  return { released: Number(result?.meta?.changes || 0) };
}

export async function claimBudgetedLiveDeriveJob(env, trigger, options = {}) {
  const coordinated = await claimCoordinatedLiveJob(env, trigger, options);
  if (coordinated !== undefined) return coordinated;
  return claimD1LiveDeriveJob(env, trigger, options);
}

export async function releaseBudgetedLiveDeriveJob(env, jobIds, options = {}) {
  const coordinated = await releaseCoordinatedLiveJobs(env, jobIds, options);
  if (coordinated !== undefined) return coordinated;
  return releaseD1LiveDeriveJobs(env, jobIds, options);
}

export const MINUTE_LIVE_TRIGGER_LEASE = Object.freeze({
  preferred_store: 'durable-object',
  fallback_store: 'd1',
});
