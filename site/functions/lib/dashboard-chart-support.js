const DAY_MS = 86_400_000;

export const PREVIOUS_DAY_HISTORY_SQL = `WITH latest_channel AS (
  SELECT channel_id
  FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_live_minute
  WHERE source_code=1
  ORDER BY minute_at DESC,id DESC
  LIMIT 1
)
SELECT r.observed_at,r.online_member_count
FROM sh_dashboard_history_5m AS r
WHERE r.channel_id=(SELECT channel_id FROM latest_channel)
  AND r.bucket_at>=? AND r.bucket_at<?
ORDER BY r.observed_at ASC
LIMIT 300`;

async function previousDayHistory(db, now) {
  if (!db) return [];
  const start = now - 2 * DAY_MS;
  const end = now - DAY_MS;
  const result = await db.prepare(PREVIOUS_DAY_HISTORY_SQL).bind(start, end).all();
  return result?.results || [];
}

export async function augmentDashboardChartData(env, payload, now = Date.now()) {
  if (!payload?.ok) return payload;
  const previousRows = await previousDayHistory(env?.MINUTE_DB, now).catch((error) => {
    console.error(error);
    return [];
  });
  return {
    ...payload,
    previous_day_history: previousRows,
  };
}
