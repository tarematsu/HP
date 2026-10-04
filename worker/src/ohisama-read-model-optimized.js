import {
  OHISAMA_PAGES_MODEL_KEY,
  mergeOhisamaDailyRows,
  nextOhisamaDailySummary,
  ohisamaReadModelPayload,
  rollOhisamaHistory,
} from './ohisama-read-model.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

const DAY_MS = 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;
const INCREMENTAL_GAP_LIMIT_MS = 11 * 60_000;
const RECOVERY_GAP_LIMIT_MS = DAY_MS;
export const OHISAMA_READ_MODEL_HOT_STATE_KEY = 'stationhead/ohisama/read-model-hot-state.json';

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

function weekStart(timestamp) {
  const start = dayStart(timestamp);
  const date = new Date(start);
  return start - ((date.getUTCDay() + 6) % 7) * DAY_MS;
}

function weekKey(timestamp) {
  return new Date(weekStart(timestamp)).toISOString().slice(0, 10);
}

function fiveMinuteBucket(timestamp) {
  return Math.floor(Number(timestamp) / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

function validPayload(payload) {
  return Boolean(payload
    && payload.model === OHISAMA_PAGES_MODEL_KEY
    && Array.isArray(payload.history_24h)
    && Array.isArray(payload.daily));
}

function upgradeLegacyPayload(payload) {
  if (!validPayload(payload)) return null;
  if (Array.isArray(payload.weekly)) return payload;
  return {
    ...payload,
    weekly: rollupOhisamaWeekly(payload.daily, integer(payload.updated_at) ?? Date.now()),
  };
}

async function readJsonObject(r2, key) {
  if (!key || typeof r2?.get !== 'function') return null;
  try {
    const object = await r2.get(key);
    if (!object) return null;
    if (typeof object.json === 'function') return await object.json();
    if (typeof object.text === 'function') return JSON.parse(await object.text());
    return null;
  } catch {
    return null;
  }
}

async function loadExistingPayload(r2) {
  const hot = await readJsonObject(r2, OHISAMA_READ_MODEL_HOT_STATE_KEY);
  if (Number(hot?.version) === 1) {
    const upgraded = upgradeLegacyPayload(hot?.payload);
    if (upgraded) return upgraded;
  }

  const legacyKey = pagesActionsR2ResponseKey(OHISAMA_PAGES_MODEL_KEY);
  const legacyEnvelope = await readJsonObject(r2, legacyKey);
  if (Number(legacyEnvelope?.version) !== 1) return null;
  const legacyPayload = typeof legacyEnvelope?.body === 'string'
    ? (() => { try { return JSON.parse(legacyEnvelope.body); } catch { return null; } })()
    : legacyEnvelope?.body;
  const upgraded = upgradeLegacyPayload(legacyPayload);
  if (!upgraded || legacyPayload?.section_updated_at) return null;
  return upgraded;
}

async function saveHotPayload(r2, payload, updatedAt) {
  if (typeof r2?.put !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is missing');
  await r2.put(OHISAMA_READ_MODEL_HOT_STATE_KEY, JSON.stringify({
    version: 1,
    updated_at: updatedAt,
    payload,
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      version: '1',
      updated_at: String(updatedAt),
      model_key: OHISAMA_PAGES_MODEL_KEY,
    },
  });
}

function lastHistoryObservedAt(payload) {
  const history = Array.isArray(payload?.history_24h) ? payload.history_24h : [];
  return integer(history.at(-1)?.observed_at);
}

function summaryBoundary(rows, key, direction) {
  const ordered = direction === 'start' ? rows : [...rows].reverse();
  for (const row of ordered) {
    const value = integer(row?.[key]);
    if (value != null) return value;
  }
  return null;
}

export function rollupOhisamaWeekly(dailyRows = [], updatedAt = Date.now()) {
  const groups = new Map();
  for (const row of Array.isArray(dailyRows) ? dailyRows : []) {
    const start = integer(row?.period_start)
      ?? (/^\d{4}-\d{2}-\d{2}$/.test(String(row?.period_key || ''))
        ? Date.parse(`${row.period_key}T00:00:00Z`)
        : null);
    if (start == null) continue;
    const key = weekKey(start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const weekly = [];
  for (const [key, sourceRows] of groups.entries()) {
    const rows = [...sourceRows].sort((left, right) => {
      const leftStart = integer(left?.period_start) ?? Date.parse(`${left?.period_key}T00:00:00Z`);
      const rightStart = integer(right?.period_start) ?? Date.parse(`${right?.period_key}T00:00:00Z`);
      return leftStart - rightStart;
    });
    const sampleCount = rows.reduce((sum, row) => sum + Math.max(0, integer(row?.sample_count) ?? 0), 0);
    const averageWeight = rows.reduce((sum, row) => {
      const count = Math.max(0, integer(row?.sample_count) ?? 0);
      return finite(row?.listener_avg) == null ? sum : sum + count;
    }, 0);
    const weightedAverage = averageWeight > 0
      ? rows.reduce((sum, row) => {
        const value = finite(row?.listener_avg);
        const count = Math.max(0, integer(row?.sample_count) ?? 0);
        return value == null ? sum : sum + value * count;
      }, 0) / averageWeight
      : null;
    const listenerMins = rows.map((row) => integer(row?.listener_min)).filter((value) => value != null);
    const listenerMaxs = rows.map((row) => integer(row?.listener_max)).filter((value) => value != null);
    const streamStart = summaryBoundary(rows, 'stream_start', 'start');
    const streamEnd = summaryBoundary(rows, 'stream_end', 'end');
    const memberStart = summaryBoundary(rows, 'member_start', 'start');
    const memberEnd = summaryBoundary(rows, 'member_end', 'end');
    const periodStarts = rows.map((row) => integer(row?.period_start)).filter((value) => value != null);
    const periodEnds = rows.map((row) => integer(row?.period_end)).filter((value) => value != null);
    weekly.push({
      period_key: key,
      period_start: periodStarts.length ? Math.min(...periodStarts) : weekStart(Date.parse(`${key}T00:00:00Z`)),
      period_end: periodEnds.length ? Math.max(...periodEnds) : weekStart(Date.parse(`${key}T00:00:00Z`)) + 7 * DAY_MS,
      sample_count: sampleCount,
      listener_avg: weightedAverage,
      listener_min: listenerMins.length ? Math.min(...listenerMins) : null,
      listener_max: listenerMaxs.length ? Math.max(...listenerMaxs) : null,
      stream_start: streamStart,
      stream_end: streamEnd,
      stream_growth: streamStart == null || streamEnd == null || streamEnd < streamStart
        ? null
        : streamEnd - streamStart,
      member_start: memberStart,
      member_end: memberEnd,
      member_growth: memberStart == null || memberEnd == null ? null : memberEnd - memberStart,
      updated_at: integer(updatedAt),
    });
  }
  return weekly.sort((left, right) => right.period_key.localeCompare(left.period_key));
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

async function persistWeeklySummary(db, row) {
  if (!row?.period_key) return false;
  await db.prepare(`INSERT INTO sh_weekly_summary(
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
    WHERE excluded.updated_at>=sh_weekly_summary.updated_at`)
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

async function loadGapRows(db, channelId, afterObservedAt, beforeObservedAt) {
  const result = await db.prepare(`SELECT
      channel_id,station_id,is_broadcasting,observed_at,
      online_member_count,total_member_count,reported_current_stream_count
    FROM sh_minute_facts
    WHERE channel_id=? AND observed_at>? AND observed_at<?
    ORDER BY observed_at ASC,id ASC`)
    .bind(channelId, afterObservedAt, beforeObservedAt)
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

async function applyObservation(payload, collection, observedAt, db) {
  const existingCurrent = payloadCurrentDaily(payload, observedAt);
  let dailyPersisted = false;
  let weeklyPersisted = false;
  if (!existingCurrent) {
    const completed = completedRowAtRollover(payload, observedAt);
    if (completed) {
      dailyPersisted = await persistDailySummary(db, completed);
      const completedWeek = rollupOhisamaWeekly(payload.daily, observedAt)
        .find((row) => row.period_key === weekKey(integer(completed.period_start)));
      if (completedWeek) weeklyPersisted = await persistWeeklySummary(db, completedWeek);
    }
  }

  const previousAt = lastHistoryObservedAt(payload);
  const sameBucket = previousAt != null
    && fiveMinuteBucket(previousAt) === fiveMinuteBucket(observedAt);
  const dailyRow = sameBucket
    ? existingCurrent
    : nextOhisamaDailySummary(existingCurrent, collection, observedAt);
  const daily = dailyRow ? mergeOhisamaDailyRows(payload.daily, dailyRow) : payload.daily;

  return {
    payload: {
      ...payload,
      updated_at: observedAt,
      latest: ohisamaReadModelPayload(collection, [], [], observedAt).latest,
      history_24h: rollOhisamaHistory(payload.history_24h, collection, observedAt),
      daily,
      weekly: rollupOhisamaWeekly(daily, observedAt),
    },
    dailyPersisted,
    weeklyPersisted,
  };
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
  const weeklyRows = rollupOhisamaWeekly(dailyRows, observedAt);
  for (const row of weeklyRows) await persistWeeklySummary(db, row);
  return {
    ...ohisamaReadModelPayload(collection, historyRows, dailyRows, observedAt),
    weekly: weeklyRows,
  };
}

export async function refreshOptimizedOhisamaReadModel(env, collection, now = Date.now()) {
  const db = env?.OHISAMA_DB;
  if (!db?.prepare) throw new Error('OHISAMA_DB binding is missing');
  const channelId = integer(collection?.channel_id);
  const observedAt = integer(collection?.observed_at ?? now);
  if (channelId == null || observedAt == null) throw new Error('ohisama collection identity is missing');

  const existingPayload = await loadExistingPayload(env?.PAGES_RESPONSE_R2);
  let payload;
  let mode = 'bootstrap';
  let dailyPersisted = false;
  let weeklyPersisted = false;
  let recoveryRows = 0;
  const previousAt = lastHistoryObservedAt(existingPayload);

  if (existingPayload && previousAt != null && previousAt <= observedAt) {
    const gap = observedAt - previousAt;
    if (gap <= INCREMENTAL_GAP_LIMIT_MS) {
      const applied = await applyObservation(existingPayload, collection, observedAt, db);
      payload = applied.payload;
      dailyPersisted = applied.dailyPersisted;
      weeklyPersisted = applied.weeklyPersisted;
      mode = 'incremental';
    } else if (gap <= RECOVERY_GAP_LIMIT_MS) {
      let recovered = existingPayload;
      const rows = await loadGapRows(db, channelId, previousAt, observedAt);
      recoveryRows = rows.length;
      for (const row of rows) {
        const rowAt = integer(row?.observed_at);
        if (rowAt == null) continue;
        const applied = await applyObservation(recovered, row, rowAt, db);
        recovered = applied.payload;
        dailyPersisted = dailyPersisted || applied.dailyPersisted;
        weeklyPersisted = weeklyPersisted || applied.weeklyPersisted;
      }
      const applied = await applyObservation(recovered, collection, observedAt, db);
      payload = applied.payload;
      dailyPersisted = dailyPersisted || applied.dailyPersisted;
      weeklyPersisted = weeklyPersisted || applied.weeklyPersisted;
      mode = 'recovery';
    }
  }

  if (!payload) {
    payload = await bootstrapPayload(db, collection, channelId, observedAt);
    weeklyPersisted = payload.weekly.length > 0;
  }

  await saveHotPayload(env?.PAGES_RESPONSE_R2, payload, observedAt);
  return {
    published: true,
    mode,
    model_key: OHISAMA_PAGES_MODEL_KEY,
    hot_state_key: OHISAMA_READ_MODEL_HOT_STATE_KEY,
    history_rows: payload.history_24h.length,
    daily_rows: payload.daily.length,
    weekly_rows: payload.weekly.length,
    daily_persisted: dailyPersisted,
    weekly_persisted: weeklyPersisted,
    recovery_rows: recoveryRows,
    updated_at: observedAt,
    payload,
  };
}

export default {
  refreshOptimizedOhisamaReadModel,
};