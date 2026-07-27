import {
  deleteCollectorHotState,
  getCollectorHotState,
  putCollectorHotState,
} from './collector-do-hot-state.js';

// Cross-tick mutex for the buddies worker's primary collection cycle.
//
// The deployed collector runs inside BuddiesCollectorCoordinator, so the lease
// lives in that Durable Object's strongly consistent storage. D1 remains only
// as a fail-open compatibility fallback for direct/failover execution where no
// coordinator hot-state API is present. This keeps operational state writes
// away from the database that owns collected Stationhead facts.
const SCOPE = 'stationhead-primary-run';
const HOT_STATE_KEY = 'lease:primary-run';
const DEFAULT_TTL_MS = 70_000;
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 180_000;

export const PRIMARY_RUN_LOCK_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS sh_primary_run_lock (
  scope TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL
)`;

const CLAIM_SQL = `INSERT INTO sh_primary_run_lock (scope,holder_id,claimed_at,lease_until)
  VALUES (?,?,?,?)
  ON CONFLICT(scope) DO UPDATE SET
    holder_id=excluded.holder_id,claimed_at=excluded.claimed_at,lease_until=excluded.lease_until
  WHERE sh_primary_run_lock.lease_until<?
  RETURNING holder_id`;

const RELEASE_SQL = `UPDATE sh_primary_run_lock SET lease_until=? WHERE scope=? AND holder_id=?`;
const STATUS_SQL = `SELECT lease_until FROM sh_primary_run_lock WHERE scope=?`;

function ttlMs(env = {}) {
  const configured = Number(env.PRIMARY_RUN_LOCK_TTL_MS ?? DEFAULT_TTL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_TTL_MS;
  return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Math.trunc(configured)));
}

export function primaryRunLockEnabled(env = {}) {
  const configured = env.PRIMARY_RUN_LOCK_ENABLED;
  if (configured == null || configured === '') return true;
  return !['0', 'false', 'no', 'off'].includes(String(configured).trim().toLowerCase());
}

function hotStateAvailable(env = {}) {
  const api = env?.__COLLECTOR_DO_HOT_STATE;
  return api && typeof api.get === 'function' && typeof api.put === 'function';
}

function noSuchTable(error) {
  return /no such table/i.test(String(error?.message || ''));
}

async function claimHotStateLock(env, holderId, now) {
  const current = await getCollectorHotState(env, HOT_STATE_KEY);
  if (current && Number(current.lease_until) >= now) return false;
  // The hot-state helper deliberately reports storage failures as false. The
  // collection lock is fail-open, so inability to persist the lease must not
  // suppress collection and create a data gap.
  await putCollectorHotState(env, HOT_STATE_KEY, {
    scope: SCOPE,
    holder_id: holderId,
    claimed_at: now,
    lease_until: now + ttlMs(env),
  });
  return true;
}

async function releaseHotStateLock(env, holderId) {
  const current = await getCollectorHotState(env, HOT_STATE_KEY);
  if (!current || current.holder_id !== holderId) return false;
  return deleteCollectorHotState(env, HOT_STATE_KEY);
}

export async function claimPrimaryRunLock(env, holderId, now = Date.now()) {
  if (!primaryRunLockEnabled(env)) return true;
  if (hotStateAvailable(env)) {
    try {
      return await claimHotStateLock(env, holderId, now);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'primary_run_lock_do_claim_failed',
        error: String(error?.message || error).slice(0, 500),
      }));
      return true;
    }
  }
  if (!env?.DB) return true;
  try {
    const leaseUntil = now + ttlMs(env);
    const row = await env.DB.prepare(CLAIM_SQL)
      .bind(SCOPE, holderId, now, leaseUntil, now)
      .first();
    return Boolean(row);
  } catch (error) {
    if (noSuchTable(error)) return true;
    console.error(JSON.stringify({
      event: 'primary_run_lock_claim_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return true;
  }
}

export async function isPrimaryRunLockActive(env, now = Date.now()) {
  if (hotStateAvailable(env)) {
    try {
      const current = await getCollectorHotState(env, HOT_STATE_KEY);
      return Boolean(current) && Number(current.lease_until) > now;
    } catch (error) {
      console.error(JSON.stringify({
        event: 'primary_run_lock_do_status_check_failed',
        error: String(error?.message || error).slice(0, 500),
      }));
      return false;
    }
  }
  if (!env?.DB) return false;
  try {
    const row = await env.DB.prepare(STATUS_SQL).bind(SCOPE).first();
    return Boolean(row) && Number(row.lease_until) > now;
  } catch (error) {
    if (noSuchTable(error)) return false;
    console.error(JSON.stringify({
      event: 'primary_run_lock_status_check_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return false;
  }
}

export async function releasePrimaryRunLock(env, holderId, now = Date.now()) {
  if (!primaryRunLockEnabled(env)) return false;
  if (hotStateAvailable(env)) {
    try {
      return await releaseHotStateLock(env, holderId);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'primary_run_lock_do_release_failed',
        error: String(error?.message || error).slice(0, 500),
      }));
      return false;
    }
  }
  if (!env?.DB) return false;
  try {
    const result = await env.DB.prepare(RELEASE_SQL).bind(now, SCOPE, holderId).run();
    return Number(result?.meta?.changes || 0) > 0;
  } catch (error) {
    if (noSuchTable(error)) return false;
    console.error(JSON.stringify({
      event: 'primary_run_lock_release_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return false;
  }
}

export const PRIMARY_RUN_LOCK_STATE = Object.freeze({
  scope: SCOPE,
  hot_state_key: HOT_STATE_KEY,
  preferred_store: 'durable-object',
  fallback_store: 'd1',
});
