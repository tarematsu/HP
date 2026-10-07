// Shared D1 authentication refresh protocol. Each source owns its own DB,
// credentials and cache; never let lower-priority auth overwrite Buddies.
export async function claimStationheadAuthRefresh(db, {
  stateId = 'stationhead',
  now = Date.now(),
  lockMs = 60_000,
  cooldownMs = 0,
} = {}) {
  if (typeof db?.prepare !== 'function') throw new Error('Stationhead auth database is unavailable');
  const cooldown = Math.max(0, Math.trunc(Number(cooldownMs) || 0));
  const condition = cooldown > 0 ? ' AND COALESCE(last_attempt_at,0)<=?' : '';
  const statement = db.prepare(`UPDATE sh_worker_auth_control
    SET lock_until=?,last_attempt_at=?,updated_at=?
    WHERE id=? AND COALESCE(lock_until,0)<?${condition}`);
  const args = [now + lockMs, now, now, stateId, now];
  if (cooldown > 0) args.push(now - cooldown);
  const result = await statement.bind(...args).run();
  return Number(result?.meta?.changes || 0) > 0;
}

export async function finishStationheadAuthRefresh(db, {
  stateId = 'stationhead', now = Date.now(), error = null,
} = {}) {
  await db.prepare(`UPDATE sh_worker_auth_control SET
      last_success_at=CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,
      last_error=?,lock_until=0,updated_at=? WHERE id=?`)
    .bind(error, now, error, now, stateId)
    .run();
}
