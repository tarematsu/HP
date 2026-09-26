const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const FIVE_MINUTE_MS = 5 * MINUTE_MS;

export const PREVIOUS_DAY_HISTORY_SQL = `SELECT r.observed_at,r.online_member_count
FROM sh_dashboard_history_5m AS r
WHERE r.channel_id=?
  AND r.bucket_at>=? AND r.bucket_at<?
ORDER BY r.observed_at ASC
LIMIT 300`;

export const STREAM_5M_HISTORY_SQL = `SELECT
  d.bucket_at+240000 AS observed_at,
  d.stream_delta_avg AS stream_delta,
  d.sample_count
FROM sh_stream_5m_average_read_model AS d
WHERE d.channel_id=?
  AND d.bucket_at>=? AND d.bucket_at<?
  AND d.sample_count=5
ORDER BY d.bucket_at ASC
LIMIT 300`;

function validChannelId(value) {
  const channelId = Number(value);
  return Number.isFinite(channelId) && channelId > 0 ? channelId : null;
}

async function previousDayHistory(db, channelId, now) {
  const numericChannelId = validChannelId(channelId);
  if (!db || numericChannelId == null) return [];
  const start = now - 2 * DAY_MS;
  const end = now - DAY_MS;
  const result = await db.prepare(PREVIOUS_DAY_HISTORY_SQL)
    .bind(numericChannelId, start, end)
    .all();
  return result?.results || [];
}

async function streamFiveMinuteHistory(db, channelId, now) {
  const numericChannelId = validChannelId(channelId);
  if (!db || numericChannelId == null) return [];
  const start = now - DAY_MS - FIVE_MINUTE_MS;
  const end = now + FIVE_MINUTE_MS;
  const result = await db.prepare(STREAM_5M_HISTORY_SQL)
    .bind(numericChannelId, start, end)
    .all();
  return result?.results || [];
}

export async function augmentDashboardChartData(env, payload, now = Date.now()) {
  if (!payload?.ok) return payload;
  const channelId = payload?.latest?.channel_id ?? payload?.channel_id;
  const [previousRows, streamRows] = await Promise.all([
    previousDayHistory(env?.MINUTE_DB, channelId, now).catch((error) => {
      console.error(error);
      return [];
    }),
    streamFiveMinuteHistory(env?.MINUTE_DB, channelId, now).catch((error) => {
      console.error(error);
      return [];
    }),
  ]);
  return {
    ...payload,
    previous_day_history: previousRows,
    stream_5m_history: streamRows,
  };
}
