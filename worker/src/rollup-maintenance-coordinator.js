import { runRollupMaintenance as runBaseRollupMaintenance } from './rollup-maintenance.js';

const RUN_PERIOD_TYPE = 'run';
const RUN_PERIOD_KEY = 'rollup-maintenance';
const DEFAULT_LEASE_MS = 15 * 60_000;
const DEFAULT_RUN_INTERVAL_MS = 60 * 60_000;
const MAX_RETRY_MS = 24 * 60 * 60_000;

function integer(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function retryDelay(attemptCount) {
  const exponent = Math.min(10, Math.max(0, integer(attemptCount) - 1));
  return Math.min(MAX_RETRY_MS, 60_000 * (2 ** exponent));
}

function leaseOwner(now) {
  const suffix = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `rollup:${now}:${suffix}`;
}

export function shouldThrottleRollupMaintenance(state, now, intervalMs = DEFAULT_RUN_INTERVAL_MS) {
  if (!state || state.status !== 'idle' || state.last_error) return false;
  const lastFinishedAt = integer(state.updated_at);
  const interval = Math.max(60_000, integer(intervalMs, DEFAULT_RUN_INTERVAL_MS));
  return lastFinishedAt > 0 && Number(now) < lastFinishedAt + interval;
}

async function loadRunCadenceState(db) {
  return db.prepare(`SELECT status,last_error,updated_at
    FROM sh_rollup_materialization_state
    WHERE period_type=? AND period_key=? LIMIT 1`)
    .bind(RUN_PERIOD_TYPE, RUN_PERIOD_KEY)
    .first();
}

async function acquireRunLease(db, owner, now, leaseMs) {
  const leaseUntil = now + leaseMs;
  await db.prepare(`INSERT INTO sh_rollup_materialization_state(
      period_type,period_key,status,lease_owner,lease_until,updated_at
    ) VALUES(?1,?2,'running',?3,?4,?5)
    ON CONFLICT(period_type,period_key) DO UPDATE SET
      status='running',lease_owner=excluded.lease_owner,
      lease_until=excluded.lease_until,updated_at=excluded.updated_at
    WHERE sh_rollup_materialization_state.lease_until<=?5
       OR sh_rollup_materialization_state.lease_owner=?3`)
    .bind(RUN_PERIOD_TYPE, RUN_PERIOD_KEY, owner, leaseUntil, now).run();
  const row = await db.prepare(`SELECT lease_owner,lease_until FROM sh_rollup_materialization_state
    WHERE period_type=? AND period_key=?`).bind(RUN_PERIOD_TYPE, RUN_PERIOD_KEY).first();
  return row?.lease_owner === owner && Number(row?.lease_until || 0) === leaseUntil;
}

async function releaseRunLease(db, owner, now, error = null) {
  await db.prepare(`UPDATE sh_rollup_materialization_state SET
      status='idle',lease_owner=NULL,lease_until=0,last_error=?1,updated_at=?2
    WHERE period_type=?3 AND period_key=?4 AND lease_owner=?5`)
    .bind(error, now, RUN_PERIOD_TYPE, RUN_PERIOD_KEY, owner).run();
}

function dailyPublished(result) {
  if (!result?.reconciliation?.complete) return false;
  const reason = result?.daily?.reason;
  return result?.daily?.generated === true
    || result?.daily?.rebuilt === true
    || reason === 'already-current';
}

function dailyStatus(result) {
  const reconciliation = result?.reconciliation || {};
  if (reconciliation.sourceEmpty) return 'empty';
  if (dailyPublished(result)) return 'published';
  if (reconciliation.jobs?.dead > 0) return 'quarantined';
  if (reconciliation.complete) return 'facts_ready';
  return 'dirty';
}

async function currentAttemptCount(db, periodKey) {
  const row = await db.prepare(`SELECT attempt_count FROM sh_rollup_materialization_state
    WHERE period_type='day' AND period_key=?`).bind(periodKey).first();
  return Number(row?.attempt_count || 0);
}

async function persistDayResult(db, result, now) {
  const reconciliation = result?.reconciliation || {};
  const status = dailyStatus(result);
  const previousAttempts = await currentAttemptCount(db, result.periodKey);
  const attemptCount = status === 'published' || status === 'empty' ? 0 : previousAttempts + 1;
  const nextAttemptAt = status === 'dirty' || status === 'facts_ready'
    ? now + retryDelay(attemptCount)
    : 0;
  const error = result?.daily?.reason || reconciliation.reason || null;
  await db.prepare(`INSERT INTO sh_rollup_materialization_state(
      period_type,period_key,status,source_generation,summary_generation,
      missing_count,stale_count,pending_count,processing_count,dead_count,
      attempt_count,next_attempt_at,lease_owner,lease_until,last_error,published_at,updated_at
    ) VALUES('day',?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL,0,?12,?13,?14)
    ON CONFLICT(period_type,period_key) DO UPDATE SET
      status=excluded.status,source_generation=excluded.source_generation,
      summary_generation=excluded.summary_generation,missing_count=excluded.missing_count,
      stale_count=excluded.stale_count,pending_count=excluded.pending_count,
      processing_count=excluded.processing_count,dead_count=excluded.dead_count,
      attempt_count=excluded.attempt_count,next_attempt_at=excluded.next_attempt_at,
      lease_owner=NULL,lease_until=0,last_error=excluded.last_error,
      published_at=excluded.published_at,updated_at=excluded.updated_at`)
    .bind(
      result.periodKey,
      status,
      reconciliation.generation || null,
      dailyPublished(result) ? reconciliation.generation || null : null,
      integer(reconciliation.missing),
      integer(reconciliation.stale),
      integer(reconciliation.jobs?.pending),
      integer(reconciliation.jobs?.processing),
      integer(reconciliation.jobs?.dead),
      attemptCount,
      nextAttemptAt,
      error,
      status === 'published' ? now : null,
      now,
    ).run();

  const legacyStatus = status === 'published' || status === 'empty'
    ? `complete:${reconciliation.generation || 'empty'}`
    : `dirty:${error || status}:${reconciliation.generation || 'unknown'}`;
  await db.prepare(`INSERT INTO sh_data_maintenance_state(
      id,last_rollup_key,last_cleanup_at,legacy_backfill_id,updated_at
    ) VALUES(?,?,0,0,?) ON CONFLICT(id) DO UPDATE SET
      last_rollup_key=excluded.last_rollup_key,updated_at=excluded.updated_at`)
    .bind(`minute-day:${result.periodKey}`, legacyStatus, now).run();
}

async function persistAggregateResult(db, periodType, outcome, now) {
  if (!outcome?.periodKey) return;
  const published = outcome.generated === true || outcome.rebuilt === true || outcome.reason === 'already-current';
  const waiting = outcome.reason === 'daily-summaries-incomplete'
    || outcome.reason === 'weekly-summaries-incomplete';
  const status = published ? 'published' : waiting ? 'waiting_dependencies' : 'dirty';
  await db.prepare(`INSERT INTO sh_rollup_materialization_state(
      period_type,period_key,status,summary_generation,attempt_count,next_attempt_at,
      last_error,published_at,updated_at
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
    ON CONFLICT(period_type,period_key) DO UPDATE SET
      status=excluded.status,summary_generation=excluded.summary_generation,
      attempt_count=excluded.attempt_count,next_attempt_at=excluded.next_attempt_at,
      last_error=excluded.last_error,published_at=excluded.published_at,
      updated_at=excluded.updated_at`)
    .bind(
      periodType,
      outcome.periodKey,
      status,
      outcome.generation || null,
      published || waiting ? 0 : 1,
      published || waiting ? 0 : now + 60_000,
      outcome.reason || null,
      published ? now : null,
      now,
    ).run();
}

async function persistRunResults(db, result, now) {
  for (const period of result?.periods || []) {
    await persistDayResult(db, period, now);
    await persistAggregateResult(db, 'week', period.weekly, now);
    await persistAggregateResult(db, 'month', period.monthly, now);
  }
}

export async function runRollupMaintenance(db, otherDb, minuteDb, now = Date.now()) {
  if (!db || !otherDb || !minuteDb) return { skipped: true, reason: 'db-binding-missing' };
  const cadenceState = await loadRunCadenceState(db);
  if (shouldThrottleRollupMaintenance(cadenceState, now)) {
    const lastRunAt = integer(cadenceState.updated_at);
    return {
      skipped: true,
      reason: 'rollup-maintenance-cadence',
      coordinator: {
        lastRunAt,
        nextRunAt: lastRunAt + DEFAULT_RUN_INTERVAL_MS,
      },
    };
  }
  const owner = leaseOwner(now);
  const leaseMs = DEFAULT_LEASE_MS;
  if (!(await acquireRunLease(db, owner, now, leaseMs))) {
    return { skipped: true, reason: 'rollup-maintenance-lease-held' };
  }
  try {
    const result = await runBaseRollupMaintenance(db, otherDb, minuteDb, now);
    await persistRunResults(db, result, now);
    await releaseRunLease(db, owner, now);
    return { ...result, coordinator: { leaseOwner: owner, persisted: true } };
  } catch (error) {
    await releaseRunLease(db, owner, now, error?.message || String(error));
    throw error;
  }
}

export async function runRollupMaintenanceSafely(db, otherDb, minuteDb, now = Date.now()) {
  try {
    return await runRollupMaintenance(db, otherDb, minuteDb, now);
  } catch (error) {
    console.error('D1 coordinated rollup maintenance failed', error);
    return { skipped: true, reason: 'maintenance-error', error: error?.message || String(error) };
  }
}
