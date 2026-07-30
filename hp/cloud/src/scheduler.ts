import type { Env } from "./sources";

export interface JobRow {
  name: string;
  interval_seconds: number;
  next_run_at: number;
  lease_until: number | null;
  last_success_at: number | null;
  consecutive_failures: number;
}

const OCTOPUS_INTERVAL_SECONDS = 3 * 60 * 60;
const SYSTEM_JOBS_CACHE_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
const DAY_SECONDS = 86_400;
const POWER_RETENTION_MS = 90 * DAY_MS;

interface SystemJobsCacheEntry {
  expiresAt: number;
  inFlight: Promise<void> | null;
}

const SYSTEM_JOBS_CACHE = new WeakMap<D1Database, SystemJobsCacheEntry>();

export function invalidateSystemJobsCache(db: D1Database): void {
  SYSTEM_JOBS_CACHE.delete(db);
}

async function reconcileSystemJobs(env: Env, nowMs: number): Promise<void> {
  const nowSeconds = Math.floor(nowMs / 1000);
  const statement = env.DB.prepare(
    `INSERT INTO jobs(
       name,interval_seconds,next_run_at,lease_until,last_success_at,last_error,consecutive_failures
     ) VALUES
       ('stationhead_health',300,0,NULL,NULL,NULL,0),
       ('octopus',?1,0,NULL,NULL,NULL,0)
     ON CONFLICT(name) DO UPDATE SET
       interval_seconds=CASE
         WHEN excluded.name='stationhead_health' THEN jobs.interval_seconds
         ELSE excluded.interval_seconds
       END,
       next_run_at=CASE
         WHEN excluded.name='stationhead_health' THEN jobs.next_run_at
         WHEN jobs.next_run_at=0 THEN 0
         WHEN jobs.next_run_at>?2+excluded.interval_seconds THEN ?2+excluded.interval_seconds
         ELSE jobs.next_run_at
       END
     WHERE excluded.name<>'stationhead_health' AND (
       jobs.interval_seconds<>excluded.interval_seconds
       OR (jobs.next_run_at<>0 AND jobs.next_run_at>?2+excluded.interval_seconds)
     )`,
  );
  await env.DB.batch([
    statement.bind(OCTOPUS_INTERVAL_SECONDS, nowSeconds),
    env.DB.prepare("DELETE FROM jobs WHERE name IN ('radar_dispatch','video_liveness')"),
  ]);
}

export async function ensureSystemJobs(env: Env, nowMs = Date.now()): Promise<void> {
  const cached = SYSTEM_JOBS_CACHE.get(env.DB);
  if (cached) {
    if (cached.inFlight) return cached.inFlight;
    if (cached.expiresAt > nowMs) return;
  }

  const entry: SystemJobsCacheEntry = { expiresAt: 0, inFlight: null };
  const task = reconcileSystemJobs(env, nowMs).then(
    () => {
      if (SYSTEM_JOBS_CACHE.get(env.DB) === entry) {
        entry.expiresAt = nowMs + SYSTEM_JOBS_CACHE_MS;
        entry.inFlight = null;
      }
    },
    error => {
      if (SYSTEM_JOBS_CACHE.get(env.DB) === entry) SYSTEM_JOBS_CACHE.delete(env.DB);
      throw error;
    },
  );
  entry.inFlight = task;
  SYSTEM_JOBS_CACHE.set(env.DB, entry);
  return task;
}

export async function cleanupExpiredData(env: Env, now = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM power_samples WHERE observed_at < ?1").bind(now - POWER_RETENTION_MS),
    env.DB.prepare(
      `DELETE FROM device_commands
        WHERE (completed_at IS NOT NULL AND completed_at < ?1)
           OR (completed_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?2)`,
    ).bind(now - 30 * DAY_MS, now - 7 * DAY_MS),
    env.DB.prepare("DELETE FROM job_runs WHERE finished_at < ?1")
      .bind(Math.floor(now / 1000) - 30 * DAY_SECONDS),
  ]);
}
