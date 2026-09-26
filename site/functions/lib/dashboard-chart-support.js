const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

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

export const STREAM_MINUTE_HISTORY_SQL = `WITH latest_channel AS (
  SELECT channel_id
  FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_live_minute
  WHERE source_code=1
  ORDER BY minute_at DESC,id DESC
  LIMIT 1
)
SELECT f.minute_at AS observed_at,f.reported_current_stream_count AS stream_count
FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
WHERE f.source_code=1
  AND f.channel_id=(SELECT channel_id FROM latest_channel)
  AND f.minute_at>=? AND f.minute_at<?
  AND f.reported_current_stream_count IS NOT NULL
ORDER BY f.minute_at DESC,f.id DESC
LIMIT 1600`;

async function previousDayHistory(db, now) {
  if (!db) return [];
  const start = now - 2 * DAY_MS;
  const end = now - DAY_MS;
  const result = await db.prepare(PREVIOUS_DAY_HISTORY_SQL).bind(start, end).all();
  return result?.results || [];
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function minuteStreamDeltas(rows, now) {
  const cutoff = now - DAY_MS;
  const byMinute = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const observedAt = finite(row?.observed_at);
    const streamCount = finite(row?.stream_count);
    if (observedAt == null || streamCount == null || byMinute.has(observedAt)) continue;
    byMinute.set(observedAt, { observed_at: observedAt, stream_count: streamCount });
  }
  const points = [...byMinute.values()].sort((a, b) => a.observed_at - b.observed_at);
  const deltas = [];
  let previous = null;
  for (const point of points) {
    if (previous) {
      const gap = point.observed_at - previous.observed_at;
      const delta = point.stream_count - previous.stream_count;
      if (
        point.observed_at >= cutoff
        && point.observed_at <= now + MINUTE_MS
        && gap >= MINUTE_MS / 2
        && gap <= MINUTE_MS * 1.5
        && delta >= 0
      ) {
        deltas.push({ observed_at: point.observed_at, stream_delta: delta });
      }
    }
    previous = point;
  }
  return deltas;
}

async function streamMinuteHistory(db, now) {
  if (!db) return [];
  const start = now - DAY_MS - 2 * MINUTE_MS;
  const end = now + MINUTE_MS;
  const result = await db.prepare(STREAM_MINUTE_HISTORY_SQL).bind(start, end).all();
  return minuteStreamDeltas(result?.results || [], now);
}

export async function augmentDashboardChartData(env, payload, now = Date.now()) {
  if (!payload?.ok) return payload;
  const [previousRows, streamRows] = await Promise.all([
    previousDayHistory(env?.MINUTE_DB, now).catch((error) => {
      console.error(error);
      return [];
    }),
    streamMinuteHistory(env?.MINUTE_DB, now).catch((error) => {
      console.error(error);
      return [];
    }),
  ]);
  return {
    ...payload,
    previous_day_history: previousRows,
    stream_minute_history: streamRows,
  };
}
