const SCOPE = 'stationhead-runtime-scheduled';
const DEFAULT_LEASE_MS = 70_000;
const MIN_LEASE_MS = 30_000;
const MAX_LEASE_MS = 180_000;

const CLAIM_SQL = `INSERT INTO sh_runtime_run_lease(
    scope,ticket,holder_id,claimed_at,lease_until,released_at
  ) VALUES(?,?,?,?,?,NULL)
  ON CONFLICT(scope) DO UPDATE SET
    ticket=excluded.ticket,holder_id=excluded.holder_id,
    claimed_at=excluded.claimed_at,lease_until=excluded.lease_until,released_at=NULL
  WHERE sh_runtime_run_lease.lease_until<?
    AND sh_runtime_run_lease.ticket IS NOT excluded.ticket
  RETURNING holder_id,lease_until`;

const RELEASE_SQL = `UPDATE sh_runtime_run_lease
  SET lease_until=MIN(lease_until,?),released_at=?
  WHERE scope=? AND holder_id=?`;

function leaseMs(value) {
  const parsed = Number(value ?? DEFAULT_LEASE_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LEASE_MS;
  return Math.max(MIN_LEASE_MS, Math.min(MAX_LEASE_MS, Math.trunc(parsed)));
}

function ticketFor(controller = {}) {
  const cron = String(controller?.cron || '');
  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  return `${cron}:${scheduledAt}`;
}

function noSuchTable(error) {
  return /no such table/i.test(String(error?.message || ''));
}

export async function claimRuntimeD1Lease(env, controller = {}, options = {}) {
  const db = env?.BUDDIES_DB;
  if (!db?.prepare) return { claimed: true, uncoordinated: true, reason: 'binding-missing' };
  const now = Number(options.now) || Date.now();
  const ticket = ticketFor(controller);
  const holderId = options.holderId || `${ticket}:${crypto.randomUUID()}`;
  try {
    const row = await db.prepare(CLAIM_SQL)
      .bind(
        SCOPE,
        ticket,
        holderId,
        now,
        now + leaseMs(env?.RUNTIME_D1_LEASE_MS),
        now,
      )
      .first();
    if (!row) return { claimed: false, reason: 'runtime-d1-duplicate-or-active' };
    return {
      claimed: true,
      holder_id: String(row.holder_id),
      lease_until: Number(row.lease_until),
    };
  } catch (error) {
    console.error(JSON.stringify({
      event: 'runtime_d1_lease_claim_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return {
      claimed: true,
      uncoordinated: true,
      reason: noSuchTable(error) ? 'migration-missing' : 'claim-failed-open',
    };
  }
}

export async function releaseRuntimeD1Lease(env, holderId, now = Date.now()) {
  if (!env?.BUDDIES_DB?.prepare || !holderId) return false;
  try {
    const result = await env.BUDDIES_DB.prepare(RELEASE_SQL)
      .bind(now, now, SCOPE, holderId)
      .run();
    return Number(result?.meta?.changes || 0) > 0;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'runtime_d1_lease_release_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return false;
  }
}

export async function runD1CoordinatedScheduled(
  controller,
  env,
  ctx,
  run,
  options = {},
) {
  const claim = await claimRuntimeD1Lease(env, controller, options);
  if (!claim.claimed) {
    return { skipped: true, reason: claim.reason };
  }
  const result = await run(controller, env, ctx);
  if (claim.holder_id) await releaseRuntimeD1Lease(env, claim.holder_id, options.now || Date.now());
  return result;
}
