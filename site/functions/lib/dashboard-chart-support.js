const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export const PREVIOUS_DAY_HISTORY_SQL = `SELECT r.observed_at,r.online_member_count
FROM sh_dashboard_history_5m AS r
WHERE r.channel_id=?
  AND r.bucket_at>=? AND r.bucket_at<?
ORDER BY r.observed_at ASC
LIMIT 300`;

export const STREAM_MINUTE_HISTORY_SQL = `SELECT
  d.minute_at AS observed_at,
  d.stream_delta
FROM sh_stream_minute_delta_read_model AS d
WHERE d.channel_id=?
  AND d.minute_at>=? AND d.minute_at<?
  AND d.stream_delta IS NOT NULL
ORDER BY d.minute_at ASC
LIMIT 1500`;

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

async function streamMinuteHistory(db, channelId, now) {
  const numericChannelId = validChannelId(channelId);
  if (!db || numericChannelId == null) return [];
  const start = now - DAY_MS;
  const end = now + MINUTE_MS;
  const result = await db.prepare(STREAM_MINUTE_HISTORY_SQL)
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
    streamMinuteHistory(env?.MINUTE_DB, channelId, now).catch((error) => {
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
