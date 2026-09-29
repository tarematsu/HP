import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

export const OHISAMA_PAGES_MODEL_KEY = 'hinata';
export const OHISAMA_PAGES_CADENCE_SECONDS = 5 * 60;

const DAY_MS = 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;
const HISTORY_WINDOW_MS = DAY_MS;
const INCREMENTAL_GAP_LIMIT_MS = 2 * FIVE_MINUTES_MS + 60_000;
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

function fiveMinuteBucket(timestamp) {
  return Math.floor(Number(timestamp) / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

function minDefined(previous, next) {
  if (next == null) return previous;
  if (previous == null) return next;
  return Math.min(previous, next);
}

function maxDefined(previous, next) {
  if (next == null) return previous;
  if (previous == null) return next;
  return Math.max(previous, next);
}

function normalizedHistoryPoint(row) {
  return {
    observed_at: integer(row?.observed_at),
    online_member_count: integer(row?.online_member_count),
    total_member_count: integer(row?.total_member_count),
    stream_count: finite(row?.stream_count ?? row?.reported_current_stream_count),
    stream_delta_5m: finite(row?.stream_delta_5m),
  };
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

function buildPayload(collection, historyRows, dailyRows, updatedAt) {
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
    history_24h: historyRows,
    daily: dailyRows,
  };
}

export function ohisamaReadModelPayload(collection, historyRows = [], dailyRows = [], updatedAt = Date.now()) {
  return buildPayload(
    collection,
    normalizeOhisamaHistory(historyRows),
    normalizeOhisamaDaily(dailyRows),
    updatedAt,
  );
}

export function nextOhisamaDailySummary(existing, collection, observedAt) {
  const start = dayStart(observedAt);
  const end = start + DAY_MS;
  const key = periodKey(start);
  const current = existing && String(existing.period_key || '') === key ? existing : null;

  const previousSamples = integer(current?.sample_count) ?? 0;
  const online = integer(collection?.online_member_count);
  const hasOnline = online != null;
  const sampleCount = previousSamples + (hasOnline ? 1 : 0);
  const previousAverage = finite(current?.listener_avg);
  let listenerAvg = previousAverage;
  if (hasOnline) {
    listenerAvg = previousAverage == null || previousSamples < 1
      ? online
      : ((previousAverage * previousSamples) + online) / (previousSamples + 1);
  }

  const stream = integer(collection?.reported_current_stream_count);
  const previousStreamStart = integer(current?.stream_start);
  const previousStreamEnd = integer(current?.stream_end);
  const streamStart = previousStreamStart ?? stream;
  const streamEnd = stream ?? previousStreamEnd;

  const members = integer(collection?.total_member_count);
  const previousMemberStart = integer(current?.member_start);
  const previousMemberEnd = integer(current?.member_end);
  const memberStart = previousMemberStart ?? members;
  const memberEnd = members ?? previousMemberEnd;

  return {
    period_key: key,
    period_start: start,
    period_end: end,
    sample_count: sampleCount,
    listener_avg: listenerAvg,
    listener_min: minDefined(integer(current?.listener_min), online),
    listener_max: maxDefined(integer(current?.listener_max), online),
    stream_start: streamStart,
    stream_end: streamEnd,
    stream_growth: streamStart == null || streamEnd == null ? null : streamEnd - streamStart,
    member_start: memberStart,
    member_end: memberEnd,
    member_growth: memberStart == null || memberEnd == null ? null : memberEnd - memberStart,
    updated_at: integer(observedAt),
  };
}

export function rollOhisamaHistory(existingRows = [], collection, observedAt) {
  const cutoff = observedAt - HISTORY_WINDOW_MS;
  const bucket = fiveMinuteBucket(observedAt);
  const rows = (Array.isArray(existingRows) ? existingRows : [])
    .map(normalizedHistoryPoint)
    .filter((row) => row.observed_at != null
      && row.observed_at >= cutoff
      && row.observed_at < observedAt
      && fiveMinuteBucket(row.observed_at) !== bucket)
    .sort((left, right) => left.observed_at - right.observed_at);

  const point = {
    observed_at: integer(collection?.observed_at ?? observedAt),
    online_member_count: integer(collection?.online_member_count),
    total_member_count: integer(collection?.total_member_count),
    stream_count: finite(collection?.reported_current_stream_count),
    stream_delta_5m: null,
  };
  const previous = rows.at(-1);
  if (previous && point.stream_count != null && previous.stream_count != null) {
    const elapsed = point.observed_at - previous.observed_at;
    const delta = point.stream_count - previous.stream_count;
    if (elapsed > 0 && delta >= 0) {
      point.stream_delta_5m = Math.round((delta * FIVE_MINUTES_MS / elapsed) * 10) / 10;
    }
  }
  return [...rows, point];
}

export function mergeOhisamaDailyRows(existingRows = [], currentRow) {
  const normalizedCurrent = normalizeOhisamaDaily([currentRow])[0];
  if (!normalizedCurrent?.period_key) return normalizeOhisamaDaily(existingRows);
  return [
    normalizedCurrent,
    ...normalizeOhisamaDaily(existingRows)
      .filter((row) => row.period_key && row.period_key !== normalizedCurrent.period_key),
  ].sort((left, right) => right.period_key.localeCompare(left.period_key));
}

async function persistDailySummary(db, row) {
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
      row.updated_at,
    )
    .run();
  return row;
}

async function rebuildDailySummary(db, channelId, observedAt) {
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

  const streamStart = integer(summary?.stream_start);
  const streamEnd = integer(summary?.stream_end);
  const memberStart = integer(summary?.member_start);
  const memberEnd = integer(summary?.member_end);
  return {
    period_key: periodKey(start),
    period_start: start,
    period_end: end,
    sample_count: integer(summary?.sample_count) ?? 0,
    listener_avg: finite(summary?.listener_avg),
    listener_min: integer(summary?.listener_min),
    listener_max: integer(summary?.listener_max),
    stream_start: streamStart,
    stream_end: streamEnd,
    stream_growth: streamStart == null || streamEnd == null ? null : streamEnd - streamStart,
    member_start: memberStart,
    member_end: memberEnd,
    member_growth: memberStart == null || memberEnd == null ? null : memberEnd - memberStart,
    updated_at: observedAt,
  };
}

async function updateDailySummaryIncremental(db, collection, observedAt) {
  const key = periodKey(observedAt);
  const existing = await db.prepare(`SELECT
      period_key,period_start,period_end,sample_count,
      listener_avg,listener_min,listener_max,
      stream_start,stream_end,stream_growth,
      member_start,member_end,member_growth,updated_at
    FROM sh_daily_summary
    WHERE period_key=? LIMIT 1`)
    .bind(key)
    .first();

  const duplicateBucket = existing?.updated_at != null
    && fiveMinuteBucket(existing.updated_at) === fiveMinuteBucket(observedAt);
  const row = duplicateBucket
    ? await rebuildDailySummary(db, integer(collection?.channel_id), observedAt)
    : nextOhisamaDailySummary(existing, collection, observedAt);
  return persistDailySummary(db, row);
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

async function loadExistingPayload(r2) {
  const key = pagesActionsR2ResponseKey(OHISAMA_PAGES_MODEL_KEY);
  if (!key || typeof r2?.get !== 'function') return null;
  try {
    const object = await r2.get(key);
    if (!object?.body) return null;
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

export async function refreshOhisamaReadModel(env, collection, now = Date.now()) {
  const db = env?.OHISAMA_DB;
  if (!db?.prepare) throw new Error('OHISAMA_DB binding is missing');
  const channelId = integer(collection?.channel_id);
  const observedAt = integer(collection?.observed_at ?? now);
  if (channelId == null || observedAt == null) throw new Error('ohisama collection identity is missing');

  const dailyRow = await updateDailySummaryIncremental(db, collection, observedAt);
  const existingPayload = await loadExistingPayload(env?.PAGES_RESPONSE_R2);

  let payload;
  let mode;
  if (canIncrementPayload(existingPayload, observedAt)) {
    payload = buildPayload(
      collection,
      rollOhisamaHistory(existingPayload.history_24h, collection, observedAt),
      mergeOhisamaDailyRows(existingPayload.daily, dailyRow),
      observedAt,
    );
    mode = 'incremental';
  } else {
    const [historyRows, dailyRows] = await Promise.all([
      loadHistory(db, channelId, observedAt),
      loadDaily(db),
    ]);
    payload = ohisamaReadModelPayload(collection, historyRows, dailyRows, observedAt);
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
    updated_at: observedAt,
  };
}
