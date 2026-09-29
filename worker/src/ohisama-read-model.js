import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

export const OHISAMA_PAGES_MODEL_KEY = 'hinata';
export const OHISAMA_PAGES_CADENCE_SECONDS = 5 * 60;

const DAY_MS = 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;
const HISTORY_WINDOW_MS = DAY_MS;
const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = finite(value);
  return number == null ? null : Math.trunc(number);
}

function streamValue(row) {
  return finite(row?.reported_current_stream_count);
}

function dayStart(timestamp) {
  return Math.floor(Number(timestamp) / DAY_MS) * DAY_MS;
}

function periodKey(timestamp) {
  return new Date(dayStart(timestamp)).toISOString().slice(0, 10);
}

export function normalizeOhisamaHistory(rows = []) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      observed_at: integer(row?.observed_at),
      online_member_count: integer(row?.online_member_count),
      total_member_count: integer(row?.total_member_count),
      stream_count: streamValue(row),
    }))
    .filter((row) => row.observed_at != null)
    .sort((left, right) => left.observed_at - right.observed_at);

  return normalized.map((row, index) => {
    const previous = normalized[index - 1];
    let streamDelta = null;
    if (previous && row.stream_count != null && previous.stream_count != null) {
      const elapsed = row.observed_at - previous.observed_at;
      const delta = row.stream_count - previous.stream_count;
      if (elapsed > 0 && delta >= 0) {
        streamDelta = delta * FIVE_MINUTES_MS / elapsed;
      }
    }
    return {
      observed_at: row.observed_at,
      online_member_count: row.online_member_count,
      total_member_count: row.total_member_count,
      stream_count: row.stream_count,
      stream_delta_5m: streamDelta == null ? null : Math.round(streamDelta * 10) / 10,
    };
  });
}

export function normalizeOhisamaDaily(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    period_key: String(row?.period_key || ''),
    period_start: integer(row?.period_start),
    period_end: integer(row?.period_end),
    sample_count: integer(row?.sample_count) ?? 0,
    listener_avg: finite(row?.listener_avg),
    listener_min: integer(row?.listener_min),
    listener_max: integer(row?.listener_max),
    stream_start: integer(row?.stream_start),
    stream_end: integer(row?.stream_end),
    stream_growth: integer(row?.stream_growth),
    member_start: integer(row?.member_start),
    member_end: integer(row?.member_end),
    member_growth: integer(row?.member_growth),
  }));
}

export function ohisamaReadModelPayload(collection, historyRows = [], dailyRows = [], updatedAt = Date.now()) {
  const streamCount = finite(collection?.reported_current_stream_count);
  return {
    ok: true,
    model: OHISAMA_PAGES_MODEL_KEY,
    channel_alias: 'ohisama',
    timezone: 'UTC',
    updated_at: integer(updatedAt),
    latest: {
      observed_at: integer(collection?.observed_at ?? updatedAt),
      channel_id: integer(collection?.channel_id),
      station_id: integer(collection?.station_id),
      is_broadcasting: integer(collection?.is_broadcasting),
      online_member_count: integer(collection?.online_member_count),
      total_member_count: integer(collection?.total_member_count),
      total_stream_count: streamCount == null ? null : Math.trunc(streamCount),
    },
    history_24h: normalizeOhisamaHistory(historyRows),
    daily: normalizeOhisamaDaily(dailyRows),
  };
}

async function refreshDailySummary(db, channelId, observedAt) {
  const start = dayStart(observedAt);
  const end = start + DAY_MS;
  const summary = await db.prepare(`WITH day_rows AS (
      SELECT
        id,minute_at,online_member_count,total_member_count,
        reported_current_stream_count AS stream_count,
        ROW_NUMBER() OVER (ORDER BY minute_at ASC,id ASC) AS first_rank,
        ROW_NUMBER() OVER (ORDER BY minute_at DESC,id DESC) AS last_rank
      FROM sh_minute_facts
      WHERE channel_id=? AND minute_at>=? AND minute_at<?
    )
    SELECT
      COUNT(*) AS sample_count,
      AVG(online_member_count) AS listener_avg,
      MIN(online_member_count) AS listener_min,
      MAX(online_member_count) AS listener_max,
      MAX(CASE WHEN first_rank=1 THEN stream_count END) AS stream_start,
      MAX(CASE WHEN last_rank=1 THEN stream_count END) AS stream_end,
      MAX(CASE WHEN first_rank=1 THEN total_member_count END) AS member_start,
      MAX(CASE WHEN last_rank=1 THEN total_member_count END) AS member_end
    FROM day_rows`)
    .bind(channelId, start, end)
    .first();

  const sampleCount = integer(summary?.sample_count) ?? 0;
  if (sampleCount < 1) return null;
  const streamStart = integer(summary?.stream_start);
  const streamEnd = integer(summary?.stream_end);
  const memberStart = integer(summary?.member_start);
  const memberEnd = integer(summary?.member_end);
  const streamGrowth = streamStart == null || streamEnd == null ? null : streamEnd - streamStart;
  const memberGrowth = memberStart == null || memberEnd == null ? null : memberEnd - memberStart;
  const key = periodKey(start);

  await db.prepare(`INSERT INTO sh_daily_summary(
      period_key,period_start,period_end,sample_count,
      listener_avg,listener_min,listener_max,
      stream_start,stream_end,stream_growth,
      member_start,member_end,member_growth,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(period_key) DO UPDATE SET
      period_start=excluded.period_start,
      period_end=excluded.period_end,
      sample_count=excluded.sample_count,
      listener_avg=excluded.listener_avg,
      listener_min=excluded.listener_min,
      listener_max=excluded.listener_max,
      stream_start=excluded.stream_start,
      stream_end=excluded.stream_end,
      stream_growth=excluded.stream_growth,
      member_start=excluded.member_start,
      member_end=excluded.member_end,
      member_growth=excluded.member_growth,
      updated_at=excluded.updated_at`)
    .bind(
      key,
      start,
      end,
      sampleCount,
      finite(summary?.listener_avg),
      integer(summary?.listener_min),
      integer(summary?.listener_max),
      streamStart,
      streamEnd,
      streamGrowth,
      memberStart,
      memberEnd,
      memberGrowth,
      observedAt,
    )
    .run();
  return key;
}

async function loadHistory(db, channelId, observedAt) {
  const result = await db.prepare(`SELECT
      observed_at,online_member_count,total_member_count,reported_current_stream_count
    FROM sh_minute_facts
    WHERE channel_id=? AND observed_at>=? AND observed_at<=?
    ORDER BY observed_at ASC,id ASC`)
    .bind(channelId, observedAt - HISTORY_WINDOW_MS, observedAt)
    .all();
  return result?.results || [];
}

async function loadDaily(db) {
  const result = await db.prepare(`SELECT
      period_key,period_start,period_end,sample_count,
      listener_avg,listener_min,listener_max,
      stream_start,stream_end,stream_growth,
      member_start,member_end,member_growth
    FROM sh_daily_summary
    ORDER BY period_key DESC`)
    .all();
  return result?.results || [];
}

async function publishPayload(r2, payload, updatedAt) {
  if (typeof r2?.put !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is missing');
  const key = pagesActionsR2ResponseKey(OHISAMA_PAGES_MODEL_KEY);
  if (!key) throw new Error('ohisama Pages read-model key is invalid');
  const envelope = {
    version: 1,
    updated_at: updatedAt,
    cadence_seconds: OHISAMA_PAGES_CADENCE_SECONDS,
    status: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  };
  await r2.put(key, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      version: '1',
      model_key: OHISAMA_PAGES_MODEL_KEY,
      updated_at: String(updatedAt),
      cadence_seconds: String(OHISAMA_PAGES_CADENCE_SECONDS),
    },
  });
  return key;
}

export async function refreshOhisamaReadModel(env, collection, now = Date.now()) {
  const db = env?.OHISAMA_DB;
  if (!db?.prepare) throw new Error('OHISAMA_DB binding is missing');
  const channelId = integer(collection?.channel_id);
  const observedAt = integer(collection?.observed_at ?? now);
  if (channelId == null || observedAt == null) throw new Error('ohisama collection identity is missing');

  await refreshDailySummary(db, channelId, observedAt);
  const [historyRows, dailyRows] = await Promise.all([
    loadHistory(db, channelId, observedAt),
    loadDaily(db),
  ]);
  const payload = ohisamaReadModelPayload(collection, historyRows, dailyRows, observedAt);
  const objectKey = await publishPayload(env?.PAGES_RESPONSE_R2, payload, observedAt);
  return {
    published: true,
    model_key: OHISAMA_PAGES_MODEL_KEY,
    object_key: objectKey,
    history_rows: payload.history_24h.length,
    daily_rows: payload.daily.length,
    updated_at: observedAt,
  };
}
