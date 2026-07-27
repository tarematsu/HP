import {
  DAY_MS,
  previousUtcDay,
  utcDayStart,
  utcMonthlyRange,
  utcWeeklyRange,
} from '../../site/functions/lib/time-buckets.js';
import { runMinuteFactsRepair } from './minute-facts-repair.js';

const STATE_ID = 'rollup-retention-v1';
const STREAM_REPAIR_STATE_ID = 'rollup-stream-repair-2026-07-v4';
const STREAM_REPAIR_KEYS = Object.freeze(['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13']);
const MINUTE_SOURCE_REPAIR_STATE_ID = 'rollup-minute-source-repair-2026-07-v1';
const MINUTE_SOURCE_REPAIR_KEYS = Object.freeze([
  '2026-07-20',
  '2026-07-21',
  '2026-07-22',
  '2026-07-23',
  '2026-07-24',
  '2026-07-25',
  '2026-07-26',
]);
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
const SUMMARY_BOUNDARIES_SQL = `SELECT
    (SELECT stream_start FROM sh_daily_summary
     WHERE period_key>=?1 AND period_key<?2 AND stream_start IS NOT NULL
     ORDER BY period_key ASC LIMIT 1) AS stream_start,
    (SELECT stream_end FROM sh_daily_summary
     WHERE period_key>=?1 AND period_key<?2 AND stream_end IS NOT NULL
     ORDER BY period_key DESC LIMIT 1) AS stream_end,
    (SELECT member_start FROM sh_daily_summary
     WHERE period_key>=?1 AND period_key<?2 AND member_start IS NOT NULL
     ORDER BY period_key ASC LIMIT 1) AS member_start,
    (SELECT member_end FROM sh_daily_summary
     WHERE period_key>=?1 AND period_key<?2 AND member_end IS NOT NULL
     ORDER BY period_key DESC LIMIT 1) AS member_end,
    (SELECT primary_host FROM sh_daily_summary
     WHERE period_key>=?1 AND period_key<?2 AND primary_host IS NOT NULL AND primary_host<>''
     GROUP BY primary_host ORDER BY SUM(reliable_sample_count) DESC,primary_host ASC LIMIT 1) AS primary_host`;

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function upsertSummary(db, table, key, aggregate, boundaries, updatedAt) {
  if (!aggregate || Number(aggregate.sample_count || 0) < 1) return false;
  const streamStart = finite(boundaries?.stream_start);
  const streamEnd = finite(boundaries?.stream_end);
  const memberStart = finite(boundaries?.member_start);
  const memberEnd = finite(boundaries?.member_end);
  await db.prepare(`INSERT INTO ${table}(
      period_key,period_start,period_end,sample_count,reliable_sample_count,
      listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,
      member_start,member_end,member_growth,likes_max,distinct_tracks,primary_host,
      quality_score,quality_flags,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(period_key) DO UPDATE SET
      period_start=excluded.period_start,period_end=excluded.period_end,
      sample_count=excluded.sample_count,reliable_sample_count=excluded.reliable_sample_count,
      listener_avg=excluded.listener_avg,listener_min=excluded.listener_min,
      listener_max=excluded.listener_max,stream_start=excluded.stream_start,
      stream_end=excluded.stream_end,stream_growth=excluded.stream_growth,
      member_start=excluded.member_start,member_end=excluded.member_end,
      member_growth=excluded.member_growth,likes_max=excluded.likes_max,
      distinct_tracks=excluded.distinct_tracks,primary_host=excluded.primary_host,
      quality_score=excluded.quality_score,quality_flags=excluded.quality_flags,
      updated_at=excluded.updated_at`).bind(
    key, finite(aggregate.period_start), finite(aggregate.period_end),
    Number(aggregate.sample_count || 0),
    Number(aggregate.reliable_sample_count ?? aggregate.sample_count ?? 0),
    finite(aggregate.listener_avg), finite(aggregate.listener_min), finite(aggregate.listener_max),
    streamStart, streamEnd,
    streamStart != null && streamEnd != null && streamEnd >= streamStart ? streamEnd - streamStart : null,
    memberStart, memberEnd, memberStart != null && memberEnd != null ? memberEnd - memberStart : null,
    finite(aggregate.likes_max), finite(aggregate.distinct_tracks), boundaries?.primary_host || null,
    finite(aggregate.quality_score) ?? 1, '["live_rollup"]', updatedAt,
  ).run();
  return true;
}

async function rollupDaily(sourceDb, otherDb, period, now) {
  const aggregate = await sourceDb.prepare(`SELECT MIN(observed_at) AS period_start,MAX(observed_at) AS period_end,
      COUNT(*) AS sample_count,COUNT(listener_count) AS reliable_sample_count,
      AVG(listener_count) AS listener_avg,MIN(listener_count) AS listener_min,
      MAX(listener_count) AS listener_max,NULL AS likes_max,NULL AS distinct_tracks,1 AS quality_score
    FROM sh_channel_snapshots WHERE observed_at>=? AND observed_at<?`)
    .bind(period.start, period.end).first();
  if (!aggregate || Number(aggregate.sample_count || 0) < 1) return false;
  const boundaries = await sourceDb.prepare(DAILY_BOUNDARIES_SQL)
    .bind(period.start, period.end).first();
  return upsertSummary(otherDb, 'sh_daily_summary', period.key, aggregate, boundaries, now);
}

async function rollupFromDaily(otherDb, table, range, now) {
  const aggregate = await otherDb.prepare(`SELECT MIN(period_start) AS period_start,MAX(period_end) AS period_end,
      SUM(sample_count) AS sample_count,SUM(reliable_sample_count) AS reliable_sample_count,
      CASE WHEN SUM(CASE WHEN listener_avg IS NOT NULL THEN reliable_sample_count ELSE 0 END)>0
        THEN SUM(listener_avg*reliable_sample_count)
          /SUM(CASE WHEN listener_avg IS NOT NULL THEN reliable_sample_count ELSE 0 END) END AS listener_avg,
      MIN(listener_min) AS listener_min,MAX(listener_max) AS listener_max,
      MAX(likes_max) AS likes_max,NULL AS distinct_tracks,
      CASE WHEN SUM(reliable_sample_count)>0
        THEN SUM(quality_score*reliable_sample_count)/SUM(reliable_sample_count) ELSE 1 END AS quality_score
    FROM sh_daily_summary WHERE period_key>=? AND period_key<?`)
    .bind(range.startKey, range.endKey).first();
  if (!aggregate || Number(aggregate.sample_count || 0) < 1) return false;
  const boundaries = await otherDb.prepare(SUMMARY_BOUNDARIES_SQL)
    .bind(range.startKey, range.endKey).first();
  return upsertSummary(otherDb, table, range.key, aggregate, boundaries, now);
}

function utcPeriod(dayKey) {
  const start = utcDayStart(dayKey);
  return { key: dayKey, start, end: start + DAY_MS };
}

async function repairSummaryKeys(stateDb, sourceDb, otherDb, stateId, keys, now) {
  const state = await stateDb.prepare(`SELECT last_rollup_key FROM sh_data_maintenance_state WHERE id=?`)
    .bind(stateId).first();
  if (state?.last_rollup_key === keys.at(-1)) {
    return { skipped: true, reason: 'already-repaired' };
  }

  const repairedDays = [];
  for (const key of keys) {
    if (await rollupDaily(sourceDb, otherDb, utcPeriod(key), now)) repairedDays.push(key);
  }
  if (repairedDays.length !== keys.length) {
    return { skipped: true, reason: 'repair-source-data-missing', repairedDays };
  }

  const weeks = new Map();
  const months = new Map();
  for (const key of repairedDays) {
    const week = utcWeeklyRange(key);
    const month = utcMonthlyRange(key);
    weeks.set(week.key, week);
    months.set(month.key, month);
  }

  const repairedWeeks = [];
  for (const [key, range] of weeks) {
    if (await rollupFromDaily(otherDb, 'sh_weekly_summary', range, now)) repairedWeeks.push(key);
  }
  const repairedMonths = [];
  for (const [key, range] of months) {
    if (await rollupFromDaily(otherDb, 'sh_monthly_summary', range, now)) repairedMonths.push(key);
  }
  if (repairedWeeks.length !== weeks.size || repairedMonths.length !== months.size) {
    return {
      skipped: true,
      reason: 'repair-summary-write-incomplete',
      repairedDays,
      repairedWeeks,
      repairedMonths,
    };
  }

  await stateDb.prepare(`INSERT INTO sh_data_maintenance_state(
      id,last_rollup_key,last_cleanup_at,legacy_backfill_id,updated_at
    ) VALUES(?,?,0,0,?) ON CONFLICT(id) DO UPDATE SET
      last_rollup_key=excluded.last_rollup_key,updated_at=excluded.updated_at`)
    .bind(stateId, keys.at(-1), now).run();
  return { skipped: false, repairedDays, repairedWeeks, repairedMonths };
}

async function repairContaminatedSummaries(stateDb, sourceDb, otherDb, now) {
  return repairSummaryKeys(
    stateDb,
    sourceDb,
    otherDb,
    STREAM_REPAIR_STATE_ID,
    STREAM_REPAIR_KEYS,
    now,
  );
}

async function repairMinuteSourceSummaries(stateDb, minuteDb, otherDb, now) {
  if (!minuteDb) return { skipped: true, reason: 'minute-db-missing' };
  return repairSummaryKeys(
    stateDb,
    minuteDb,
    otherDb,
    MINUTE_SOURCE_REPAIR_STATE_ID,
    MINUTE_SOURCE_REPAIR_KEYS,
    now,
  );
}

const IMMUTABLE_SUMMARY_STATE_ID = 'immutable-summary-rollups-v1';

async function summaryExists(db, table, key) {
  const row = await db.prepare(`SELECT 1 AS present FROM ${table} WHERE period_key=? LIMIT 1`)
    .bind(key).first();
  return Boolean(row);
}

async function distinctSourceMinutes(db, period) {
  const row = await db.prepare(`SELECT COUNT(DISTINCT CAST(channel_id AS TEXT)||':'||CAST(observed_at/60000 AS INTEGER)) AS count
    FROM sh_channel_snapshots WHERE observed_at>=? AND observed_at<?`)
    .bind(period.start, period.end).first();
  return Number(row?.count || 0);
}

async function blockedMinuteJobs(minuteDb, period) {
  const row = await minuteDb.prepare(`SELECT COUNT(*) AS count
    FROM sh_minute_fact_jobs
    WHERE minute_at>=? AND minute_at<? AND status<>'done'`)
    .bind(period.start, period.end).first();
  return Number(row?.count || 0);
}

async function immutableDailyReady(sourceDb, minuteDb, period) {
  const [sourceMinutes, factMinutes, blocked] = await Promise.all([
    distinctSourceMinutes(sourceDb, period),
    distinctSourceMinutes(minuteDb, period),
    blockedMinuteJobs(minuteDb, period),
  ]);
  return {
    ready: sourceMinutes > 0 && factMinutes >= sourceMinutes && blocked === 0,
    sourceMinutes,
    factMinutes,
    blocked,
  };
}

async function insertDailyOnce(sourceDb, minuteDb, otherDb, period, now) {
  if (await summaryExists(otherDb, 'sh_daily_summary', period.key)) {
    return { skipped: true, reason: 'already-generated', periodKey: period.key };
  }
  const readiness = await immutableDailyReady(sourceDb, minuteDb, period);
  if (!readiness.ready) {
    return { skipped: true, reason: 'minute-facts-incomplete', periodKey: period.key, readiness };
  }
  const aggregate = await minuteDb.prepare(`SELECT MIN(observed_at) AS period_start,MAX(observed_at) AS period_end,
      COUNT(*) AS sample_count,COUNT(listener_count) AS reliable_sample_count,
      AVG(listener_count) AS listener_avg,MIN(listener_count) AS listener_min,
      MAX(listener_count) AS listener_max,NULL AS likes_max,NULL AS distinct_tracks,1 AS quality_score
    FROM sh_channel_snapshots WHERE observed_at>=? AND observed_at<?`)
    .bind(period.start, period.end).first();
  const boundaries = await minuteDb.prepare(DAILY_BOUNDARIES_SQL)
    .bind(period.start, period.end).first();
  if (!aggregate || Number(aggregate.sample_count || 0) < 1) {
    return { skipped: true, reason: 'minute-facts-empty', periodKey: period.key, readiness };
  }
  const streamStart = finite(boundaries?.stream_start);
  const streamEnd = finite(boundaries?.stream_end);
  const memberStart = finite(boundaries?.member_start);
  const memberEnd = finite(boundaries?.member_end);
  await otherDb.prepare(`INSERT INTO sh_daily_summary(
      period_key,period_start,period_end,sample_count,reliable_sample_count,
      listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,
      member_start,member_end,member_growth,likes_max,distinct_tracks,primary_host,
      quality_score,quality_flags,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      period.key, finite(aggregate.period_start), finite(aggregate.period_end),
      Number(aggregate.sample_count || 0),
      Number(aggregate.reliable_sample_count ?? aggregate.sample_count ?? 0),
      finite(aggregate.listener_avg), finite(aggregate.listener_min), finite(aggregate.listener_max),
      streamStart, streamEnd,
      streamStart != null && streamEnd != null && streamEnd >= streamStart ? streamEnd - streamStart : null,
      memberStart, memberEnd, memberStart != null && memberEnd != null ? memberEnd - memberStart : null,
      finite(aggregate.likes_max), finite(aggregate.distinct_tracks), boundaries?.primary_host || null,
      finite(aggregate.quality_score) ?? 1, '["immutable_daily"]', now,
    ).run();
  return { skipped: false, periodKey: period.key, readiness };
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function completeDailyRange(otherDb, range) {
  const expected = Math.round((range.end - range.start) / DAY_MS);
  const row = await otherDb.prepare(`SELECT COUNT(*) AS count FROM sh_daily_summary
    WHERE period_key>=? AND period_key<?`)
    .bind(dayKey(range.start), dayKey(range.end)).first();
  return Number(row?.count || 0) === expected;
}

async function insertWeeklyOnce(otherDb, range, now) {
  if (await summaryExists(otherDb, 'sh_weekly_summary', range.key)) {
    return { skipped: true, reason: 'already-generated', periodKey: range.key };
  }
  if (!(await completeDailyRange(otherDb, range))) {
    return { skipped: true, reason: 'daily-summaries-incomplete', periodKey: range.key };
  }
  const written = await rollupFromDaily(otherDb, 'sh_weekly_summary', range, now);
  return { skipped: !written, reason: written ? null : 'daily-summaries-empty', periodKey: range.key };
}

async function completeWeeklyCoverage(otherDb, monthRange) {
  const firstWeek = utcWeeklyRange(dayKey(monthRange.start));
  const lastWeek = utcWeeklyRange(dayKey(monthRange.end - 1));
  const expected = Math.round((lastWeek.start - firstWeek.start) / (7 * DAY_MS)) + 1;
  const row = await otherDb.prepare(`SELECT COUNT(*) AS count FROM sh_weekly_summary
    WHERE period_start>=? AND period_start<=?`)
    .bind(firstWeek.start, lastWeek.start).first();
  return Number(row?.count || 0) === expected;
}

async function insertMonthlyOnce(otherDb, range, now) {
  if (await summaryExists(otherDb, 'sh_monthly_summary', range.key)) {
    return { skipped: true, reason: 'already-generated', periodKey: range.key };
  }
  if (!(await completeWeeklyCoverage(otherDb, range))) {
    return { skipped: true, reason: 'weekly-summaries-incomplete', periodKey: range.key };
  }
  const written = await rollupFromDaily(otherDb, 'sh_monthly_summary', range, now);
  return { skipped: !written, reason: written ? null : 'daily-summaries-empty', periodKey: range.key };
}

// Maintenance state remains in Buddies DB. Summary source rows prefer MINUTE_DB's
// minute-backed sh_channel_snapshots compatibility view; UTC rollups are stored
// in OTHER_DB because only monitoring and Pages read them.
export async function runRollupMaintenance(db, otherDb, minuteDb, now = Date.now()) {
  if (typeof minuteDb === 'number') {
    now = minuteDb;
    minuteDb = null;
  }
  if (!db || !otherDb || !minuteDb) return { skipped: true, reason: 'db-binding-missing' };
  const period = previousUtcDay(now);
  const daily = await insertDailyOnce(db, minuteDb, otherDb, period, now);
  const weekly = await insertWeeklyOnce(otherDb, utcWeeklyRange(period.key), now);
  const monthly = await insertMonthlyOnce(otherDb, utcMonthlyRange(period.key), now);
  await db.prepare(`INSERT INTO sh_data_maintenance_state(
      id,last_rollup_key,last_cleanup_at,legacy_backfill_id,updated_at
    ) VALUES(?,?,0,0,?) ON CONFLICT(id) DO UPDATE SET
      last_rollup_key=excluded.last_rollup_key,updated_at=excluded.updated_at`)
    .bind(IMMUTABLE_SUMMARY_STATE_ID, period.key, now).run();
  return {
    skipped: daily.skipped && weekly.skipped && monthly.skipped,
    periodKey: period.key,
    daily,
    weekly,
    monthly,
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
