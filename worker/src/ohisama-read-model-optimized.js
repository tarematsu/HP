import {
  OHISAMA_PAGES_CADENCE_SECONDS,
  OHISAMA_PAGES_MODEL_KEY,
  mergeOhisamaDailyRows,
  nextOhisamaDailySummary,
  ohisamaReadModelPayload,
  rollOhisamaHistory,
} from './ohisama-read-model.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

const DAY_MS = 24 * 60 * 60_000;
const INCREMENTAL_GAP_LIMIT_MS = 11 * 60_000;
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

function dayStart(timestamp) {
  return Math.floor(Number(timestamp) / DAY_MS) * DAY_MS;
}

function periodKey(timestamp) {
  return new Date(dayStart(timestamp)).toISOString().slice(0, 10);
}

async function loadExistingPayload(r2) {
  const key = pagesActionsR2ResponseKey(OHISAMA_PAGES_MODEL_KEY);
  if (!key || typeof r2?.get !== 'function') return null;
  try {
    const object = await r2.get(key);
    if (!object?.body && typeof object?.json !== 'function') return null;
    const envelope = await object.json();
    if (Number(envelope?.version) !== 1) return null;
    const payload = typeof envelope?.body === 'string'
      ? JSON.parse(envelope.body)
      : envelope?.body;
    if (!payload || payload.model !== OHISAMA_PAGES_MODEL_KEY) return null;
    if (!Array.isArray(payload.history_24h) || !Array.isArray(payload.daily)) return null;
    return payload;
  } catch {
    return null;
  }
}

function canIncrementPayload(payload, observedAt) {
  if (!payload) return false;
  const history = Array.isArray(payload.history_24h) ? payload.history_24h : [];
  const lastObservedAt = integer(history.at(-1)?.observed_at);
  if (lastObservedAt == null || lastObservedAt > observedAt) return false;
  return observedAt - lastObservedAt <= INCREMENTAL_GAP_LIMIT_MS;
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

async function persistDailySummary(db, row) {
  if (!row?.period_key) return false;
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
      updated_at=excluded.updated_at
    WHERE excluded.updated_at>sh_daily_summary.updated_at`)
    .bind(
      row.period_key,
      row.period_start,
      row.period_end,
      row.sample_count,
      row.listener_avg,
      row.listener_min,
      row.listener_max,
      row.stream_start,
      row.stream_end,
      row.stream_growth,
      row.member_start,
      row.member_end,
      row.member_growth,
      row.updated_at ?? row.period_end,
    )
    .run();
  return true;
}

async function rebuildDaySummary(db, channelId, start, updatedAt) {
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
      COUNT(*) AS row_count,
      COUNT(online_member_count) AS sample_count,
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
  if (!summary || Number(summary.row_count || 0) < 1) return null;

  const streamStart = integer(summary.stream_start);
  const streamEnd = integer(summary.stream_end);
  const memberStart = integer(summary.member_start);
  const memberEnd = integer(summary.member_end);
  return {
    period_key: periodKey(start),
    period_start: start,
    period_end: end,
    sample_count: integer(summary.sample_count) ?? 0,
    listener_avg: finite(summary.listener_avg),
    listener_min: integer(summary.listener_min),
    listener_max: integer(summary.listener_max),
    stream_start: streamStart,
    stream_end: streamEnd,
    stream_growth: streamStart == null || streamEnd == null ? null : streamEnd - streamStart,
    member_start: memberStart,
    member_end: memberEnd,
    member_growth: memberStart == null || memberEnd == null ? null : memberEnd - memberStart,
    updated_at: integer(updatedAt),
  };
}

async function loadHistory(db, channelId, observedAt) {
  const result = await db.prepare(`SELECT
      observed_at,online_member_count,total_member_count,reported_current_stream_count
    FROM sh_minute_facts
    WHERE channel_id=? AND observed_at>=? AND observed_at<=?
    ORDER BY observed_at ASC,id ASC`)
    .bind(channelId, observedAt - DAY_MS, observedAt)
    .all();
  return result?.results || [];
}

async function loadCompletedDaily(db, currentDayStart) {
  const result = await db.prepare(`SELECT
      period_key,period_start,period_end,sample_count,
      listener_avg,listener_min,listener_max,
      stream_start,stream_end,stream_growth,
      member_start,member_end,member_growth
    FROM sh_daily_summary
    WHERE period_start<?
    ORDER BY period_key DESC`)
    .bind(currentDayStart)
    .all();
  return result?.results || [];
}

function payloadCurrentDaily(payload, observedAt) {
  const key = periodKey(observedAt);
  return (Array.isArray(payload?.daily) ? payload.daily : [])
    .find((row) => String(row?.period_key || '') === key) || null;
}

function completedRowAtRollover(payload, observedAt) {
  const currentStart = dayStart(observedAt);
  return (Array.isArray(payload?.daily) ? payload.daily : [])
    .filter((row) => integer(row?.period_start) != null && integer(row.period_start) < currentStart)
    .sort((left, right) => integer(right.period_start) - integer(left.period_start))[0] || null;
}

async function bootstrapPayload(db, collection, channelId, observedAt) {
  const currentStart = dayStart(observedAt);
  const previousStart = currentStart - DAY_MS;
  const previous = await rebuildDaySummary(db, channelId, previousStart, currentStart);
  if (previous) await persistDailySummary(db, previous);

  const [historyRows, completedDaily, currentDaily] = await Promise.all([
    loadHistory(db, channelId, observedAt),
    loadCompletedDaily(db, currentStart),
    rebuildDaySummary(db, channelId, currentStart, observedAt),
  ]);
  const dailyRows = currentDaily
    ? mergeOhisamaDailyRows(completedDaily, currentDaily)
    : completedDaily;
  return ohisamaReadModelPayload(collection, historyRows, dailyRows, observedAt);
}

export async function refreshOptimizedOhisamaReadModel(env, collection, now = Date.now()) {
  const db = env?.OHISAMA_DB;
  if (!db?.prepare) throw new Error('OHISAMA_DB binding is missing');
  const channelId = integer(collection?.channel_id);
  const observedAt = integer(collection?.observed_at ?? now);
  if (channelId == null || observedAt == null) throw new Error('ohisama collection identity is missing');

  const existingPayload = await loadExistingPayload(env?.PAGES_RESPONSE_R2);
  let payload;
  let mode;
  let dailyPersisted = false;

  if (canIncrementPayload(existingPayload, observedAt)) {
    const existingCurrent = payloadCurrentDaily(existingPayload, observedAt);
    if (!existingCurrent) {
      const completed = completedRowAtRollover(existingPayload, observedAt);
      if (completed) dailyPersisted = await persistDailySummary(db, completed);
    }
    const dailyRow = nextOhisamaDailySummary(existingCurrent, collection, observedAt);
    payload = {
      ...existingPayload,
      updated_at: observedAt,
      latest: ohisamaReadModelPayload(collection, [], [], observedAt).latest,
      history_24h: rollOhisamaHistory(existingPayload.history_24h, collection, observedAt),
      daily: mergeOhisamaDailyRows(existingPayload.daily, dailyRow),
    };
    mode = 'incremental';
  } else {
    payload = await bootstrapPayload(db, collection, channelId, observedAt);
    mode = 'bootstrap';
  }

  const objectKey = await publishPayload(env?.PAGES_RESPONSE_R2, payload, observedAt);
  return {
    published: true,
    mode,
    model_key: OHISAMA_PAGES_MODEL_KEY,
    object_key: objectKey,
    history_rows: payload.history_24h.length,
    daily_rows: payload.daily.length,
    daily_persisted: dailyPersisted,
    updated_at: observedAt,
  };
}

export default {
  refreshOptimizedOhisamaReadModel,
};
