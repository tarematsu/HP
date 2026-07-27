import {
  DAY_MS,
  utcDayKey,
  utcDayStart,
  utcMonthlyRange,
  utcWeeklyRange,
} from '../../site/functions/lib/time-buckets.js';
import { REBUILD_STATE_KEY } from './minute-facts-backfill.js';
import { runMinuteFactsRepair } from './minute-facts-repair.js';

const MINUTE_MS = 60_000;
const DAILY_TABLE = 'sh_daily_summary';
const WEEKLY_TABLE = 'sh_weekly_summary';
const MONTHLY_TABLE = 'sh_monthly_summary';
const FINAL_DAILY_FLAGS = '["minute_facts_final"]';
const FINAL_WEEKLY_FLAGS = '["daily_summary_final"]';
const FINAL_MONTHLY_FLAGS = '["daily_summary_final","weekly_gate_final"]';

const STREAM_VALUE_SQL = `COALESCE(
  CASE WHEN validated_stream_count IS NOT NULL AND validated_stream_count>=0
    AND validated_stream_count IS NOT total_listens THEN validated_stream_count END,
  CASE WHEN current_stream_count IS NOT NULL AND current_stream_count>=0
    AND current_stream_count IS NOT total_listens THEN current_stream_count END
)`;

const DAILY_BOUNDARIES_SQL = `SELECT
    (SELECT ${STREAM_VALUE_SQL} FROM sh_channel_snapshots
     WHERE observed_at>=?1 AND observed_at<?2 AND ${STREAM_VALUE_SQL} IS NOT NULL
     ORDER BY observed_at ASC,id ASC LIMIT 1) AS stream_start,
    (SELECT ${STREAM_VALUE_SQL} FROM sh_channel_snapshots
     WHERE observed_at>=?1 AND observed_at<?2 AND ${STREAM_VALUE_SQL} IS NOT NULL
     ORDER BY observed_at DESC,id DESC LIMIT 1) AS stream_end,
    (SELECT total_member_count FROM sh_channel_snapshots
     WHERE observed_at>=?1 AND observed_at<?2 AND total_member_count IS NOT NULL
     ORDER BY observed_at ASC,id ASC LIMIT 1) AS member_start,
    (SELECT total_member_count FROM sh_channel_snapshots
     WHERE observed_at>=?1 AND observed_at<?2 AND total_member_count IS NOT NULL
     ORDER BY observed_at DESC,id DESC LIMIT 1) AS member_end,
    (SELECT host_handle FROM sh_channel_snapshots
     WHERE observed_at>=?1 AND observed_at<?2 AND host_handle IS NOT NULL AND host_handle<>''
     GROUP BY host_handle ORDER BY COUNT(*) DESC,host_handle ASC LIMIT 1) AS primary_host`;

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function dayKey(timestamp) {
  return new Date(Number(timestamp)).toISOString().slice(0, 10);
}

function monthKey(timestamp) {
  return dayKey(timestamp).slice(0, 7);
}

function nextMonthStart(timestamp) {
  const date = new Date(Number(timestamp));
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function previousMonthStart(timestamp) {
  const date = new Date(Number(timestamp));
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1);
}

export function dailyKeysInRange(startKey, endKey) {
  const keys = [];
  for (
    let cursor = utcDayStart(startKey), end = utcDayStart(endKey);
    cursor < end;
    cursor += DAY_MS
  ) {
    keys.push(dayKey(cursor));
  }
  return keys;
}

export function weeklyKeysIntersectingMonth(month) {
  const range = utcMonthlyRange(`${month}-01`);
  const monthStart = utcDayStart(range.startKey);
  const monthEnd = utcDayStart(range.endKey);
  const firstWeek = utcWeeklyRange(range.startKey);
  const keys = [];
  for (let cursor = utcDayStart(firstWeek.startKey); cursor < monthEnd; cursor += 7 * DAY_MS) {
    if (cursor + 7 * DAY_MS > monthStart) keys.push(dayKey(cursor));
  }
  return keys;
}

async function latestSummaryKey(db, table) {
  const row = await db.prepare(`SELECT period_key FROM ${table}
    ORDER BY period_key DESC LIMIT 1`).first();
  return row?.period_key ? String(row.period_key) : null;
}

async function summaryExists(db, table, key) {
  const row = await db.prepare(`SELECT 1 AS present FROM ${table}
    WHERE period_key=? LIMIT 1`).bind(key).first();
  return Boolean(row);
}

async function nextDailyPeriod(otherDb, now) {
  const currentDay = utcDayStart(utcDayKey(now));
  const last = await latestSummaryKey(otherDb, DAILY_TABLE);
  const start = last == null
    ? currentDay - DAY_MS
    : utcDayStart(last) + DAY_MS;
  if (start >= currentDay) return null;
  return { key: dayKey(start), start, end: start + DAY_MS };
}

async function nextWeeklyPeriod(otherDb, now) {
  const currentDay = utcDayStart(utcDayKey(now));
  const last = await latestSummaryKey(otherDb, WEEKLY_TABLE);
  let start;
  if (last == null) {
    const currentWeek = utcWeeklyRange(dayKey(currentDay));
    start = utcDayStart(currentWeek.startKey) - 7 * DAY_MS;
  } else {
    start = utcDayStart(last) + 7 * DAY_MS;
  }
  const range = utcWeeklyRange(dayKey(start));
  if (utcDayStart(range.endKey) > currentDay) return null;
  return range;
}

async function nextMonthlyPeriod(otherDb, now) {
  const currentMonthStart = utcDayStart(`${monthKey(now)}-01`);
  const last = await latestSummaryKey(otherDb, MONTHLY_TABLE);
  const start = last == null
    ? previousMonthStart(currentMonthStart)
    : nextMonthStart(utcDayStart(`${last}-01`));
  if (start >= currentMonthStart) return null;
  return utcMonthlyRange(dayKey(start));
}

async function insertSummaryOnce(db, table, key, aggregate, boundaries, flags, updatedAt) {
  if (!aggregate || Number(aggregate.sample_count || 0) < 1) {
    return { written: false, reason: 'no-source-data' };
  }
  const streamStart = finite(boundaries?.stream_start);
  const streamEnd = finite(boundaries?.stream_end);
  const memberStart = finite(boundaries?.member_start);
  const memberEnd = finite(boundaries?.member_end);
  const result = await db.prepare(`INSERT OR IGNORE INTO ${table}(
      period_key,period_start,period_end,sample_count,reliable_sample_count,
      listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,
      member_start,member_end,member_growth,likes_max,distinct_tracks,primary_host,
      quality_score,quality_flags,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    key,
    finite(aggregate.period_start),
    finite(aggregate.period_end),
    Number(aggregate.sample_count || 0),
    Number(aggregate.reliable_sample_count ?? aggregate.sample_count ?? 0),
    finite(aggregate.listener_avg),
    finite(aggregate.listener_min),
    finite(aggregate.listener_max),
    streamStart,
    streamEnd,
    streamStart != null && streamEnd != null && streamEnd >= streamStart
      ? streamEnd - streamStart
      : null,
    memberStart,
    memberEnd,
    memberStart != null && memberEnd != null ? memberEnd - memberStart : null,
    finite(aggregate.likes_max),
    finite(aggregate.distinct_tracks),
    boundaries?.primary_host || null,
    finite(aggregate.quality_score) ?? 1,
    flags,
    updatedAt,
  ).run();
  const written = Number(result?.meta?.changes || 0) > 0;
  return { written, reason: written ? null : 'already-finalized' };
}

async function loadRebuildState(minuteDb) {
  try {
    return await minuteDb.prepare(`SELECT
        cursor_observed_at,cursor_snapshot_id,pending_json,last_error
      FROM sh_minute_fact_rebuild_state
      WHERE rebuild_key=? LIMIT 1`).bind(REBUILD_STATE_KEY).first();
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return null;
    throw error;
  }
}

function pendingCandidatesInPeriod(state, period) {
  return safeJson(state?.pending_json, [])
    .filter((candidate) => {
      const minuteAt = integer(candidate?.minuteAt);
      return minuteAt != null && minuteAt >= period.start && minuteAt < period.end;
    })
    .length;
}

async function unscannedSourceExists(sourceDb, state, period) {
  const cursorAt = integer(state?.cursor_observed_at) ?? 0;
  const cursorId = integer(state?.cursor_snapshot_id) ?? 0;
  const row = await sourceDb.prepare(`SELECT 1 AS pending
    FROM sh_channel_snapshots
    WHERE observed_at>=? AND observed_at<?
      AND (observed_at>? OR (observed_at=? AND id>?))
    LIMIT 1`).bind(
    period.start,
    period.end,
    cursorAt,
    cursorAt,
    cursorId,
  ).first();
  return Boolean(row);
}

async function unfinishedMinuteJobs(minuteDb, period) {
  const row = await minuteDb.prepare(`SELECT COUNT(*) AS count
    FROM sh_minute_fact_jobs
    WHERE minute_at>=? AND minute_at<? AND status IN ('pending','processing','dead')`)
    .bind(period.start, period.end)
    .first();
  return Number(row?.count || 0);
}

async function unfinishedRepairs(minuteDb, period) {
  try {
    const row = await minuteDb.prepare(`SELECT COUNT(*) AS count
      FROM sh_minute_fact_repairs
      WHERE minute_at>=? AND minute_at<?
        AND status NOT IN ('repaired','preserved')`)
      .bind(period.start, period.end)
      .first();
    return Number(row?.count || 0);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return 0;
    throw error;
  }
}

function minuteKey(row) {
  return `${integer(row?.channel_id)}:${integer(row?.minute_at)}`;
}

async function sourceMinuteKeys(sourceDb, period) {
  const result = await sourceDb.prepare(`SELECT
      channel_id,CAST(observed_at/${MINUTE_MS} AS INTEGER)*${MINUTE_MS} AS minute_at
    FROM sh_channel_snapshots
    WHERE observed_at>=? AND observed_at<? AND channel_id IS NOT NULL
    GROUP BY channel_id,minute_at
    ORDER BY channel_id,minute_at`)
    .bind(period.start, period.end)
    .all();
  return result.results || [];
}

async function factMinuteKeys(minuteDb, period) {
  const result = await minuteDb.prepare(`SELECT channel_id,minute_at
    FROM sh_minute_facts
    WHERE minute_at>=? AND minute_at<?
    ORDER BY channel_id,minute_at`)
    .bind(period.start, period.end)
    .all();
  return result.results || [];
}

export async function inspectDailySummaryReadiness(sourceDb, minuteDb, period) {
  const rebuildState = await loadRebuildState(minuteDb);
  if (!rebuildState) {
    return { ready: false, reason: 'rebuild-state-missing' };
  }
  const pendingCandidates = pendingCandidatesInPeriod(rebuildState, period);
  if (pendingCandidates > 0) {
    return {
      ready: false,
      reason: 'rebuild-candidates-pending',
      pending_candidates: pendingCandidates,
    };
  }
  if (await unscannedSourceExists(sourceDb, rebuildState, period)) {
    return { ready: false, reason: 'rebuild-scan-pending' };
  }

  const jobs = await unfinishedMinuteJobs(minuteDb, period);
  if (jobs > 0) {
    return { ready: false, reason: 'minute-fact-jobs-pending', unfinished_jobs: jobs };
  }
  const repairs = await unfinishedRepairs(minuteDb, period);
  if (repairs > 0) {
    return { ready: false, reason: 'minute-fact-repairs-pending', unfinished_repairs: repairs };
  }

  const sourceRows = await sourceMinuteKeys(sourceDb, period);
  if (!sourceRows.length) {
    return { ready: false, reason: 'no-buddies-source-minutes' };
  }
  const factRows = await factMinuteKeys(minuteDb, period);
  const factKeys = new Set(factRows.map(minuteKey));
  const missing = sourceRows.filter((row) => !factKeys.has(minuteKey(row)));
  if (missing.length > 0) {
    return {
      ready: false,
      reason: 'minute-facts-incomplete',
      source_minutes: sourceRows.length,
      fact_minutes: factRows.length,
      missing_minutes: missing.length,
      first_missing: minuteKey(missing[0]),
    };
  }
  return {
    ready: true,
    reason: null,
    source_minutes: sourceRows.length,
    fact_minutes: factRows.length,
  };
}

async function rollupDailyOnce(minuteDb, otherDb, period, now) {
  if (await summaryExists(otherDb, DAILY_TABLE, period.key)) {
    return { written: false, reason: 'already-finalized', period_key: period.key };
  }
  const aggregate = await minuteDb.prepare(`SELECT
      MIN(observed_at) AS period_start,MAX(observed_at) AS period_end,
      COUNT(*) AS sample_count,COUNT(listener_count) AS reliable_sample_count,
      AVG(listener_count) AS listener_avg,MIN(listener_count) AS listener_min,
      MAX(listener_count) AS listener_max,NULL AS likes_max,NULL AS distinct_tracks,
      1 AS quality_score
    FROM sh_channel_snapshots
    WHERE observed_at>=? AND observed_at<?`)
    .bind(period.start, period.end)
    .first();
  const boundaries = await minuteDb.prepare(DAILY_BOUNDARIES_SQL)
    .bind(period.start, period.end)
    .first();
  const result = await insertSummaryOnce(
    otherDb,
    DAILY_TABLE,
    period.key,
    aggregate,
    boundaries,
    FINAL_DAILY_FLAGS,
    now,
  );
  return { ...result, period_key: period.key };
}

async function loadSummaryKeys(db, table, keys) {
  if (!keys.length) return [];
  const placeholders = keys.map(() => '?').join(',');
  const result = await db.prepare(`SELECT period_key FROM ${table}
    WHERE period_key IN (${placeholders})
    ORDER BY period_key`).bind(...keys).all();
  return (result.results || []).map((row) => String(row.period_key));
}

async function completeSummaryKeys(db, table, keys) {
  const existing = await loadSummaryKeys(db, table, keys);
  const existingSet = new Set(existing);
  const missing = keys.filter((key) => !existingSet.has(key));
  return { complete: missing.length === 0, existing, missing };
}

function summaryBoundariesSql(table) {
  return `SELECT
    (SELECT stream_start FROM ${table}
     WHERE period_key>=?1 AND period_key<?2 AND stream_start IS NOT NULL
     ORDER BY period_key ASC LIMIT 1) AS stream_start,
    (SELECT stream_end FROM ${table}
     WHERE period_key>=?1 AND period_key<?2 AND stream_end IS NOT NULL
     ORDER BY period_key DESC LIMIT 1) AS stream_end,
    (SELECT member_start FROM ${table}
     WHERE period_key>=?1 AND period_key<?2 AND member_start IS NOT NULL
     ORDER BY period_key ASC LIMIT 1) AS member_start,
    (SELECT member_end FROM ${table}
     WHERE period_key>=?1 AND period_key<?2 AND member_end IS NOT NULL
     ORDER BY period_key DESC LIMIT 1) AS member_end,
    (SELECT primary_host FROM ${table}
     WHERE period_key>=?1 AND period_key<?2 AND primary_host IS NOT NULL AND primary_host<>''
     GROUP BY primary_host ORDER BY SUM(reliable_sample_count) DESC,primary_host ASC LIMIT 1)
       AS primary_host`;
}

async function rollupSummaryRangeOnce(
  otherDb,
  sourceTable,
  targetTable,
  range,
  flags,
  now,
) {
  if (await summaryExists(otherDb, targetTable, range.key)) {
    return { written: false, reason: 'already-finalized', period_key: range.key };
  }
  const aggregate = await otherDb.prepare(`SELECT
      MIN(period_start) AS period_start,MAX(period_end) AS period_end,
      SUM(sample_count) AS sample_count,SUM(reliable_sample_count) AS reliable_sample_count,
      CASE WHEN SUM(CASE WHEN listener_avg IS NOT NULL THEN reliable_sample_count ELSE 0 END)>0
        THEN SUM(listener_avg*reliable_sample_count)
          /SUM(CASE WHEN listener_avg IS NOT NULL THEN reliable_sample_count ELSE 0 END)
      END AS listener_avg,
      MIN(listener_min) AS listener_min,MAX(listener_max) AS listener_max,
      MAX(likes_max) AS likes_max,NULL AS distinct_tracks,
      CASE WHEN SUM(reliable_sample_count)>0
        THEN SUM(quality_score*reliable_sample_count)/SUM(reliable_sample_count)
        ELSE 1
      END AS quality_score
    FROM ${sourceTable}
    WHERE period_key>=? AND period_key<?`)
    .bind(range.startKey, range.endKey)
    .first();
  const boundaries = await otherDb.prepare(summaryBoundariesSql(sourceTable))
    .bind(range.startKey, range.endKey)
    .first();
  const result = await insertSummaryOnce(
    otherDb,
    targetTable,
    range.key,
    aggregate,
    boundaries,
    flags,
    now,
  );
  return { ...result, period_key: range.key };
}

async function finalizeNextDaily(sourceDb, minuteDb, otherDb, now) {
  const period = await nextDailyPeriod(otherDb, now);
  if (!period) return { written: false, reason: 'daily-current' };
  const readiness = await inspectDailySummaryReadiness(sourceDb, minuteDb, period);
  if (!readiness.ready) {
    return { written: false, period_key: period.key, ...readiness };
  }
  const result = await rollupDailyOnce(minuteDb, otherDb, period, now);
  return { ...result, readiness };
}

async function finalizeNextWeekly(otherDb, now) {
  const range = await nextWeeklyPeriod(otherDb, now);
  if (!range) return { written: false, reason: 'weekly-current' };
  const expectedDays = dailyKeysInRange(range.startKey, range.endKey);
  const daily = await completeSummaryKeys(otherDb, DAILY_TABLE, expectedDays);
  if (!daily.complete) {
    return {
      written: false,
      reason: 'daily-summaries-incomplete',
      period_key: range.key,
      missing_daily: daily.missing,
    };
  }
  return rollupSummaryRangeOnce(
    otherDb,
    DAILY_TABLE,
    WEEKLY_TABLE,
    range,
    FINAL_WEEKLY_FLAGS,
    now,
  );
}

async function finalizeNextMonthly(otherDb, now) {
  const range = await nextMonthlyPeriod(otherDb, now);
  if (!range) return { written: false, reason: 'monthly-current' };
  const expectedDays = dailyKeysInRange(range.startKey, range.endKey);
  const daily = await completeSummaryKeys(otherDb, DAILY_TABLE, expectedDays);
  if (!daily.complete) {
    return {
      written: false,
      reason: 'daily-summaries-incomplete',
      period_key: range.key,
      missing_daily: daily.missing,
    };
  }
  const expectedWeeks = weeklyKeysIntersectingMonth(range.key);
  const weekly = await completeSummaryKeys(otherDb, WEEKLY_TABLE, expectedWeeks);
  if (!weekly.complete) {
    return {
      written: false,
      reason: 'weekly-summaries-incomplete',
      period_key: range.key,
      missing_weekly: weekly.missing,
    };
  }
  return rollupSummaryRangeOnce(
    otherDb,
    DAILY_TABLE,
    MONTHLY_TABLE,
    range,
    FINAL_MONTHLY_FLAGS,
    now,
  );
}

export async function runRollupMaintenance(db, otherDb, minuteDb, now = Date.now()) {
  if (typeof minuteDb === 'number') {
    now = minuteDb;
    minuteDb = null;
  }
  if (!db || !otherDb || !minuteDb) {
    return { skipped: true, reason: 'db-binding-missing' };
  }

  const minuteFactsRepair = await runMinuteFactsRepair({ DB: db, MINUTE_DB: minuteDb }, now);
  const daily = await finalizeNextDaily(db, minuteDb, otherDb, now);
  const weekly = await finalizeNextWeekly(otherDb, now);
  const monthly = await finalizeNextMonthly(otherDb, now);
  const written = [daily, weekly, monthly].filter((result) => result?.written).length;
  return {
    skipped: written === 0,
    reason: written === 0 ? 'no-finalizable-summary' : null,
    written,
    daily,
    weekly,
    monthly,
    minuteFactsRepair,
    legacyBackfill: { skipped: true, reason: 'legacy-migration-disabled' },
  };
}

export async function runRollupMaintenanceSafely(db, otherDb, minuteDb, now = Date.now()) {
  try {
    return await runRollupMaintenance(db, otherDb, minuteDb, now);
  } catch (error) {
    console.error('D1 rollup maintenance failed', error);
    return { skipped: true, reason: 'maintenance-error', error: error?.message || String(error) };
  }
}
