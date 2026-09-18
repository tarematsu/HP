import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';

const DAY_MS = 86_400_000;
const DEFAULT_DAILY_LOOKBACK_DAYS = 45;
const DEFAULT_WEEKLY_LOOKBACK_DAYS = 300;
const DEFAULT_MONTHLY_LOOKBACK_MONTHS = 12;
const workerRoot = resolve(import.meta.dirname, '..');
const wranglerScript = resolve(workerRoot, 'node_modules/wrangler/bin/wrangler.js');

const MINUTE_STREAM_VALUE_SQL = `CASE WHEN current_stream_count IS NOT NULL
  AND current_stream_count>=0 AND current_stream_count IS NOT total_listens
  THEN current_stream_count END`;
const MINUTE_DAILY_ROWS_CTE = `WITH daily_fact_rows AS MATERIALIZED (
  SELECT
    f.id,f.minute_at AS observed_at,f.channel_id,f.listener_count,
    f.total_member_count,f.reported_total_listens,f.reported_current_stream_count,
    f.broadcast_session_id
  FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_time
  WHERE f.minute_at>=?1 AND f.minute_at<?2
), selected_channel AS (
  SELECT channel_id FROM daily_fact_rows
  GROUP BY channel_id
  ORDER BY COUNT(*) DESC,MAX(observed_at) DESC,channel_id ASC
  LIMIT 1
), selected_rows AS MATERIALIZED (
  SELECT
    f.id,f.observed_at,f.channel_id,f.listener_count,
    COALESCE(d.last_total_member_count,f.total_member_count) AS total_member_count,
    f.reported_total_listens AS total_listens,
    f.reported_current_stream_count AS current_stream_count,
    h.current_handle AS host_handle
  FROM daily_fact_rows AS f
  LEFT JOIN sh_minute_fact_context_v2 AS c ON c.fact_id=f.id
  LEFT JOIN sh_broadcast_sessions AS session ON session.id=f.broadcast_session_id
  LEFT JOIN sh_hosts AS h ON h.id=COALESCE(c.host_id_override,session.host_id)
  LEFT JOIN sh_total_member_daily_latest AS d
    ON d.channel_id=f.channel_id
    AND d.day_at=(f.observed_at/86400000)*86400000
  WHERE f.channel_id=(SELECT channel_id FROM selected_channel)
)`;
const MINUTE_DAILY_SUMMARY_SQL = `${MINUTE_DAILY_ROWS_CTE}
SELECT
  channel_id,MIN(observed_at) AS period_start,MAX(observed_at) AS period_end,
  COUNT(*) AS sample_count,COUNT(listener_count) AS reliable_sample_count,
  AVG(listener_count) AS listener_avg,MIN(listener_count) AS listener_min,
  MAX(listener_count) AS listener_max,NULL AS likes_max,NULL AS distinct_tracks,1 AS quality_score,
  (SELECT ${MINUTE_STREAM_VALUE_SQL} FROM selected_rows
   WHERE ${MINUTE_STREAM_VALUE_SQL} IS NOT NULL
   ORDER BY observed_at ASC,id ASC LIMIT 1) AS stream_start,
  (SELECT ${MINUTE_STREAM_VALUE_SQL} FROM selected_rows
   WHERE ${MINUTE_STREAM_VALUE_SQL} IS NOT NULL
   ORDER BY observed_at DESC,id DESC LIMIT 1) AS stream_end,
  (SELECT total_member_count FROM selected_rows
   WHERE total_member_count IS NOT NULL
   ORDER BY observed_at ASC,id ASC LIMIT 1) AS member_start,
  (SELECT total_member_count FROM selected_rows
   WHERE total_member_count IS NOT NULL
   ORDER BY observed_at DESC,id DESC LIMIT 1) AS member_end,
  (SELECT host_handle FROM selected_rows
   WHERE host_handle IS NOT NULL AND host_handle<>''
   GROUP BY host_handle ORDER BY COUNT(*) DESC,host_handle ASC LIMIT 1) AS primary_host
FROM selected_rows
GROUP BY channel_id`;

const DAILY_AGGREGATE_SQL = `SELECT MIN(period_start) AS period_start,MAX(period_end) AS period_end,
  SUM(sample_count) AS sample_count,SUM(reliable_sample_count) AS reliable_sample_count,
  CASE WHEN SUM(CASE WHEN listener_avg IS NOT NULL THEN reliable_sample_count ELSE 0 END)>0
    THEN SUM(listener_avg*reliable_sample_count)
      /SUM(CASE WHEN listener_avg IS NOT NULL THEN reliable_sample_count ELSE 0 END) END AS listener_avg,
  MIN(listener_min) AS listener_min,MAX(listener_max) AS listener_max,
  MAX(likes_max) AS likes_max,NULL AS distinct_tracks,
  CASE WHEN SUM(reliable_sample_count)>0
    THEN SUM(quality_score*reliable_sample_count)/SUM(reliable_sample_count) ELSE 1 END AS quality_score
FROM sh_daily_summary WHERE period_key>=? AND period_key<?`;
const DAILY_BOUNDARIES_SQL = `SELECT
  (SELECT stream_start FROM sh_daily_summary WHERE period_key>=?1 AND period_key<?2 AND stream_start IS NOT NULL ORDER BY period_key ASC LIMIT 1) AS stream_start,
  (SELECT stream_end FROM sh_daily_summary WHERE period_key>=?1 AND period_key<?2 AND stream_end IS NOT NULL ORDER BY period_key DESC LIMIT 1) AS stream_end,
  (SELECT member_start FROM sh_daily_summary WHERE period_key>=?1 AND period_key<?2 AND member_start IS NOT NULL ORDER BY period_key ASC LIMIT 1) AS member_start,
  (SELECT member_end FROM sh_daily_summary WHERE period_key>=?1 AND period_key<?2 AND member_end IS NOT NULL ORDER BY period_key DESC LIMIT 1) AS member_end,
  (SELECT primary_host FROM sh_daily_summary WHERE period_key>=?1 AND period_key<?2 AND primary_host IS NOT NULL AND primary_host<>'' GROUP BY primary_host ORDER BY SUM(reliable_sample_count) DESC,primary_host ASC LIMIT 1) AS primary_host`;

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dayStart(value) {
  return Date.parse(`${value}T00:00:00Z`);
}

function previousDayKey(now) {
  const current = new Date(now);
  const today = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  return isoDay(today - DAY_MS);
}

function completedDailyKeys(now, lookbackDays) {
  const last = dayStart(previousDayKey(now));
  const count = Math.max(1, Math.trunc(Number(lookbackDays) || DEFAULT_DAILY_LOOKBACK_DAYS));
  const keys = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) keys.push(isoDay(last - offset * DAY_MS));
  return keys;
}

function mondayKey(timestamp) {
  const date = new Date(timestamp);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const day = new Date(start).getUTCDay();
  return isoDay(start - ((day + 6) % 7) * DAY_MS);
}

function completedWeeklyRanges(now, lookbackDays) {
  const currentMonday = dayStart(mondayKey(now));
  const first = currentMonday - Math.max(7, Number(lookbackDays) || DEFAULT_WEEKLY_LOOKBACK_DAYS) * DAY_MS;
  const ranges = [];
  for (let start = dayStart(mondayKey(first)); start + 7 * DAY_MS <= currentMonday; start += 7 * DAY_MS) {
    const startKey = isoDay(start);
    ranges.push({ key: startKey, startKey, endKey: isoDay(start + 7 * DAY_MS) });
  }
  return ranges;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addMonths(date, amount) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function completedMonthlyRanges(now, lookbackMonths) {
  const current = new Date(now);
  const currentMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const count = Math.max(1, Math.trunc(Number(lookbackMonths) || DEFAULT_MONTHLY_LOOKBACK_MONTHS));
  const ranges = [];
  for (let offset = count; offset >= 1; offset -= 1) {
    const start = addMonths(currentMonth, -offset);
    const end = addMonths(start, 1);
    ranges.push({ key: monthKey(start), startKey: `${monthKey(start)}-01`, endKey: `${monthKey(end)}-01` });
  }
  return ranges;
}

async function existingKeys(db, table, from, to) {
  const result = await db.prepare(`SELECT period_key FROM ${table} WHERE period_key>=? AND period_key<? ORDER BY period_key ASC`)
    .bind(from, to).all();
  return new Set((result.results || []).map((row) => String(row.period_key)));
}

async function upsertSummary(db, table, key, aggregate, boundaries, now, qualityFlags) {
  if (!aggregate || Number(aggregate.sample_count || 0) < 1) return false;
  const sampleCount = Number(aggregate.sample_count || 0);
  const reliableSampleCount = Number(aggregate.reliable_sample_count ?? sampleCount);
  if (table === 'sh_daily_summary' && (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 1440
      || !Number.isInteger(reliableSampleCount) || reliableSampleCount < 0 || reliableSampleCount > sampleCount)) {
    throw new Error(`gap repair refused invalid daily counts for ${key}: ${sampleCount}/${reliableSampleCount}`);
  }
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
    listener_avg=excluded.listener_avg,listener_min=excluded.listener_min,listener_max=excluded.listener_max,
    stream_start=excluded.stream_start,stream_end=excluded.stream_end,stream_growth=excluded.stream_growth,
    member_start=excluded.member_start,member_end=excluded.member_end,member_growth=excluded.member_growth,
    likes_max=excluded.likes_max,distinct_tracks=excluded.distinct_tracks,primary_host=excluded.primary_host,
    quality_score=excluded.quality_score,quality_flags=excluded.quality_flags,updated_at=excluded.updated_at`)
    .bind(
      key, finite(aggregate.period_start), finite(aggregate.period_end), sampleCount, reliableSampleCount,
      finite(aggregate.listener_avg), finite(aggregate.listener_min), finite(aggregate.listener_max),
      streamStart, streamEnd, streamStart != null && streamEnd != null && streamEnd >= streamStart ? streamEnd - streamStart : null,
      memberStart, memberEnd, memberStart != null && memberEnd != null ? memberEnd - memberStart : null,
      finite(aggregate.likes_max), finite(aggregate.distinct_tracks), boundaries?.primary_host || null,
      finite(aggregate.quality_score) ?? 1, qualityFlags, now,
    ).run();
  return true;
}

async function repairDaily(minuteDb, otherDb, now, lookbackDays) {
  const keys = completedDailyKeys(now, lookbackDays);
  const existing = await existingKeys(otherDb, 'sh_daily_summary', keys[0], isoDay(dayStart(keys.at(-1)) + DAY_MS));
  const repaired = [];
  const unavailable = [];
  for (const key of keys) {
    if (existing.has(key)) continue;
    const start = dayStart(key);
    const summary = await minuteDb.prepare(MINUTE_DAILY_SUMMARY_SQL).bind(start, start + DAY_MS).first();
    if (!summary || Number(summary.sample_count || 0) < 1) {
      unavailable.push(key);
      continue;
    }
    if (await upsertSummary(otherDb, 'sh_daily_summary', key, summary, summary, now, '["pages_gap_repair"]')) repaired.push(key);
  }
  return { repaired, unavailable };
}

async function repairAggregateMode(otherDb, table, ranges, now) {
  if (!ranges.length) return { repaired: [] };
  const existing = await existingKeys(otherDb, table, ranges[0].key, ranges.at(-1).key < '9999' ? `${ranges.at(-1).key}~` : '9999');
  const repaired = [];
  for (const range of ranges) {
    if (existing.has(range.key)) continue;
    const [aggregate, boundaries] = await Promise.all([
      otherDb.prepare(DAILY_AGGREGATE_SQL).bind(range.startKey, range.endKey).first(),
      otherDb.prepare(DAILY_BOUNDARIES_SQL).bind(range.startKey, range.endKey).first(),
    ]);
    if (!aggregate || Number(aggregate.sample_count || 0) < 1) continue;
    if (await upsertSummary(otherDb, table, range.key, aggregate, boundaries, now, '["pages_gap_repair"]')) repaired.push(range.key);
  }
  return { repaired };
}

export async function repairPagesSummaryGaps({
  minuteDb,
  otherDb,
  now = Date.now(),
  dailyLookbackDays = DEFAULT_DAILY_LOOKBACK_DAYS,
  weeklyLookbackDays = DEFAULT_WEEKLY_LOOKBACK_DAYS,
  monthlyLookbackMonths = DEFAULT_MONTHLY_LOOKBACK_MONTHS,
} = {}) {
  if (!minuteDb || !otherDb) throw new Error('minuteDb and otherDb are required');
  const daily = await repairDaily(minuteDb, otherDb, now, dailyLookbackDays);
  const weekly = await repairAggregateMode(
    otherDb,
    'sh_weekly_summary',
    completedWeeklyRanges(now, weeklyLookbackDays),
    now,
  );
  const monthly = await repairAggregateMode(
    otherDb,
    'sh_monthly_summary',
    completedMonthlyRanges(now, monthlyLookbackMonths),
    now,
  );
  return { ok: true, daily, weekly, monthly };
}

async function main() {
  const minuteDb = createWranglerRemoteD1({
    database: process.env.FACTS_DATABASE_NAME || 'stationhead-minute',
    cwd: workerRoot,
    wranglerScript,
  });
  const otherDb = createWranglerRemoteD1({
    database: process.env.OTHER_DATABASE_NAME || 'stationhead-other',
    cwd: workerRoot,
    wranglerScript,
  });
  const result = await repairPagesSummaryGaps({ minuteDb, otherDb });
  console.log(JSON.stringify({ event: 'pages_summary_gap_repair', ...result }));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();