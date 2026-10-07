import {
  mergeStationheadDailyRows,
  nextStationheadDailySummary,
  rollStationheadHistory,
  rollupStationheadWeekly,
  stationheadAggregateReadModelPayload,
} from '../../packages/sh-shared/stationhead-read-models.mjs';
import { requireStationheadSourceProfile } from '../../packages/sh-shared/stationhead-source.mjs';
import {
  loadStationheadReadModelState,
  saveStationheadReadModelHotState,
  stationheadFiveMinuteBucket,
  stationheadReadModelGapMode,
  STATIONHEAD_READ_MODEL_INCREMENTAL_GAP_MS,
  STATIONHEAD_READ_MODEL_RECOVERY_GAP_MS,
} from './stationhead-read-model-state.js';

const OHISAMA_SOURCE = 'ohisama';
const OHISAMA_PROFILE = requireStationheadSourceProfile(OHISAMA_SOURCE);
export const OHISAMA_PAGES_MODEL_KEY = OHISAMA_PROFILE.modelKey;
export const OHISAMA_PAGES_CADENCE_SECONDS = OHISAMA_PROFILE.publicationCadenceSeconds;

const DAY_MS = 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;
const INCREMENTAL_GAP_LIMIT_MS = STATIONHEAD_READ_MODEL_INCREMENTAL_GAP_MS;
const RECOVERY_GAP_LIMIT_MS = STATIONHEAD_READ_MODEL_RECOVERY_GAP_MS;
export const OHISAMA_READ_MODEL_HOT_STATE_KEY = OHISAMA_PROFILE.readModelHotKey;

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
    weekly: rollupStationheadWeekly(payload.daily, integer(payload.updated_at) ?? Date.now()),
  };
}

async function loadExistingPayload(r2) {
  const loaded = await loadStationheadReadModelState(r2, {
    hotKey: OHISAMA_READ_MODEL_HOT_STATE_KEY,
    modelKey: OHISAMA_PAGES_MODEL_KEY,
    upgrade: upgradeLegacyPayload,
    acceptPublic: (payload) => !payload?.section_updated_at,
  });
  return loaded.payload;
}

function saveHotPayload(r2, payload, updatedAt) {
  return saveStationheadReadModelHotState(
    r2,
    OHISAMA_READ_MODEL_HOT_STATE_KEY,
    payload,
    updatedAt,
    { modelKey: OHISAMA_PAGES_MODEL_KEY },
  );
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
      const completedWeek = rollupStationheadWeekly(payload.daily, observedAt)
        .find((row) => row.period_key === weekKey(integer(completed.period_start)));
      if (completedWeek) weeklyPersisted = await persistWeeklySummary(db, completedWeek);
    }
  }

  const previousAt = lastHistoryObservedAt(payload);
  const sameBucket = previousAt != null
    && stationheadFiveMinuteBucket(previousAt) === stationheadFiveMinuteBucket(observedAt);
  const dailyRow = sameBucket
    ? existingCurrent
    : nextStationheadDailySummary(existingCurrent, collection, observedAt);
  const daily = dailyRow ? mergeStationheadDailyRows(payload.daily, dailyRow) : payload.daily;

  return {
    payload: {
      ...payload,
      updated_at: observedAt,
      latest: stationheadAggregateReadModelPayload(OHISAMA_SOURCE, collection, [], [], observedAt).latest,
      history_24h: rollStationheadHistory(payload.history_24h, collection, observedAt),
      daily,
      weekly: rollupStationheadWeekly(daily, observedAt),
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
    ? mergeStationheadDailyRows(completedDaily, currentDaily)
    : completedDaily;
  const weeklyRows = rollupStationheadWeekly(dailyRows, observedAt);
  for (const row of weeklyRows) await persistWeeklySummary(db, row);
  return {
    ...stationheadAggregateReadModelPayload(OHISAMA_SOURCE, collection, historyRows, dailyRows, observedAt),
    weekly: weeklyRows,
  };
}

export async function refreshOhisamaReadModel(env, collection, now = Date.now()) {
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
    const gapMode = stationheadReadModelGapMode(previousAt, observedAt, {
      incrementalGapMs: INCREMENTAL_GAP_LIMIT_MS,
      recoveryGapMs: RECOVERY_GAP_LIMIT_MS,
    });
    if (gapMode === 'incremental') {
      const applied = await applyObservation(existingPayload, collection, observedAt, db);
      payload = applied.payload;
      dailyPersisted = applied.dailyPersisted;
      weeklyPersisted = applied.weeklyPersisted;
      mode = 'incremental';
    } else if (gapMode === 'recovery') {
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
  refreshOhisamaReadModel,
};