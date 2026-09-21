const DAY_MS = 86_400_000;
const BUCKET_MS = 5 * 60_000;

export const PREVIOUS_DAY_HISTORY_SQL = `WITH latest_channel AS (
  SELECT channel_id
  FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_live_minute
  WHERE source_code=1
  ORDER BY minute_at DESC,id DESC
  LIMIT 1
)
SELECT
  r.bucket_at,r.observed_at,r.listener_count,r.online_member_count,
  r.total_member_count,r.total_listens,r.comment_velocity
FROM sh_dashboard_history_5m AS r
WHERE r.channel_id=(SELECT channel_id FROM latest_channel)
  AND r.bucket_at>=? AND r.bucket_at<?
ORDER BY r.observed_at ASC
LIMIT 300`;

export const COMMENT_VELOCITY_FALLBACK_SQL = `SELECT observed_at,comment_velocity
FROM sh_comment_velocity_samples
WHERE source_scope='solo'
  AND observed_at>=? AND observed_at<?
  AND (? IS NULL OR station_id=?)
ORDER BY observed_at ASC
LIMIT 2000`;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bucketAt(value) {
  const timestamp = finite(value);
  return timestamp == null ? null : Math.floor(timestamp / BUCKET_MS) * BUCKET_MS;
}

export function velocityFallbackByBucket(rows) {
  const byBucket = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const bucket = bucketAt(row?.observed_at);
    const velocity = finite(row?.comment_velocity);
    if (bucket == null || velocity == null || velocity < 0) continue;
    byBucket.set(bucket, Math.max(byBucket.get(bucket) || 0, velocity));
  }
  return byBucket;
}

export function mergeVelocityFallback(rows, fallbackRows) {
  const fallback = fallbackRows instanceof Map ? fallbackRows : velocityFallbackByBucket(fallbackRows);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const bucket = bucketAt(row?.bucket_at ?? row?.observed_at);
    const base = finite(row?.comment_velocity);
    const recovered = bucket == null ? null : finite(fallback.get(bucket));
    if (recovered == null || (base != null && base >= recovered)) return row;
    return { ...row, comment_velocity: recovered };
  });
}

async function previousDayHistory(db, now) {
  if (!db) return [];
  const start = now - 2 * DAY_MS;
  const end = now - DAY_MS;
  const result = await db.prepare(PREVIOUS_DAY_HISTORY_SQL).bind(start, end).all();
  return result?.results || [];
}

async function commentVelocityFallback(db, payload, now) {
  if (!db) return [];
  const stationId = finite(payload?.latest?.station_id);
  const start = now - 2 * DAY_MS;
  const result = await db.prepare(COMMENT_VELOCITY_FALLBACK_SQL)
    .bind(start, now, stationId, stationId)
    .all();
  return result?.results || [];
}

export async function augmentDashboardChartData(env, payload, now = Date.now()) {
  if (!payload?.ok) return payload;
  const [previousRows, fallbackRows] = await Promise.all([
    previousDayHistory(env?.MINUTE_DB, now).catch((error) => {
      console.error(error);
      return [];
    }),
    commentVelocityFallback(env?.OTHER_DB, payload, now).catch((error) => {
      console.error(error);
      return [];
    }),
  ]);
  const fallback = velocityFallbackByBucket(fallbackRows);
  return {
    ...payload,
    history: mergeVelocityFallback(payload.history, fallback),
    previous_day_history: mergeVelocityFallback(previousRows, fallback),
  };
}
