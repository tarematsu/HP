const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const FIVE_MINUTE_MS = 5 * MINUTE_MS;

export const CURRENT_HISTORY_SQL = `SELECT
  r.bucket_at AS observed_at,
  r.listener_count,
  r.online_member_count,
  r.total_member_count,
  r.total_listens,
  r.current_stream_count
FROM sh_dashboard_history_5m AS r
WHERE r.channel_id=?
  AND r.bucket_at>=? AND r.bucket_at<?
ORDER BY r.bucket_at ASC
LIMIT 300`;

export const PREVIOUS_DAY_HISTORY_SQL = `SELECT r.bucket_at AS observed_at,r.online_member_count
FROM sh_dashboard_history_5m AS r
WHERE r.channel_id=?
  AND r.bucket_at>=? AND r.bucket_at<?
ORDER BY r.bucket_at ASC
LIMIT 300`;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fiveMinuteBucket(value) {
  const timestamp = finite(value);
  return timestamp == null ? null : Math.floor(timestamp / FIVE_MINUTE_MS) * FIVE_MINUTE_MS;
}

export function directFiveMinuteStreamHistory(rows) {
  const byBucket = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const bucket = fiveMinuteBucket(row?.observed_at);
    const streamCount = finite(row?.current_stream_count);
    if (bucket == null || streamCount == null) continue;
    byBucket.set(bucket, { bucket, streamCount });
  }
  const points = [...byBucket.values()].sort((left, right) => left.bucket - right.bucket);
  const output = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (current.bucket - previous.bucket !== FIVE_MINUTE_MS) continue;
    const delta = current.streamCount - previous.streamCount;
    if (!Number.isFinite(delta) || delta < 0) continue;
    output.push({ observed_at: current.bucket, stream_delta: delta, sample_count: 1 });
  }
  return output;
}

function validChannelId(value) {
  const channelId = Number(value);
  return Number.isFinite(channelId) && channelId > 0 ? channelId : null;
}

async function currentHistory(db, channelId, now) {
  const numericChannelId = validChannelId(channelId);
  if (!db || numericChannelId == null) return [];
  const result = await db.prepare(CURRENT_HISTORY_SQL)
    .bind(numericChannelId, now - DAY_MS - FIVE_MINUTE_MS, now + FIVE_MINUTE_MS)
    .all();
  return result?.results || [];
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

export async function augmentDashboardChartData(env, payload, now = Date.now()) {
  if (!payload?.ok) return payload;
  const channelId = payload?.latest?.channel_id ?? payload?.channel_id;
  const suppliedHistory = Array.isArray(payload.history) && payload.history.length
    ? payload.history
    : null;
  const [history, previousRows] = await Promise.all([
    suppliedHistory
      ? Promise.resolve(suppliedHistory)
      : currentHistory(env?.MINUTE_DB, channelId, now).catch((error) => {
          console.error(error);
          return [];
        }),
    previousDayHistory(env?.MINUTE_DB, channelId, now).catch((error) => {
      console.error(error);
      return [];
    }),
  ]);
  return {
    ...payload,
    history,
    previous_day_history: previousRows,
    stream_5m_history: directFiveMinuteStreamHistory(history),
  };
}
