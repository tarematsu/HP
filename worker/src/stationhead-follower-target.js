function normalizedHandle(value) {
  return String(value || '').trim().toLowerCase();
}

export async function registerStationheadFollowerTarget(
  env,
  snapshot,
  observedAt,
  sourceMaskValue,
) {
  const handle = normalizedHandle(snapshot?.host_handle);
  const sourceMask = Math.max(0, Math.trunc(Number(sourceMaskValue) || 0));
  if (snapshot?.is_broadcasting !== 1 || !handle || sourceMask <= 0) return false;
  if (typeof env?.OTHER_DB?.prepare !== 'function') return false;
  const result = await env.OTHER_DB.prepare(`INSERT INTO sh_stationhead_follower_targets(
      handle,source_mask,first_seen_at,live_confirmed_at
    ) VALUES(?,?,?,?)
    ON CONFLICT(handle) DO UPDATE SET
      source_mask=(sh_stationhead_follower_targets.source_mask | excluded.source_mask),
      live_confirmed_at=COALESCE(sh_stationhead_follower_targets.live_confirmed_at,excluded.live_confirmed_at)
    WHERE (sh_stationhead_follower_targets.source_mask & excluded.source_mask)=0
       OR sh_stationhead_follower_targets.live_confirmed_at IS NULL`)
    .bind(handle, sourceMask, observedAt, observedAt)
    .run();
  return Number(result?.meta?.changes || 0) > 0;
}
