const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_LOOKBACK_DAYS = 45;

export const RECENT_DAILY_PROJECTION_SQL = `SELECT
  channel_id,day_at,period_start,period_end,sample_count,reliable_sample_count,
  listener_sum,listener_min,listener_max,stream_start,stream_end,updated_at
FROM sh_current_daily_summary
WHERE day_at>=? AND day_at<?
ORDER BY day_at ASC,sample_count DESC,period_end DESC,channel_id ASC`;

export const RECENT_DAILY_MEMBER_SQL = `SELECT
  channel_id,day_at,last_total_member_count,last_observed_at,host_key
FROM sh_total_member_daily INDEXED BY idx_sh_total_member_daily_latest
WHERE channel_id=? AND day_at>=? AND day_at<?
ORDER BY day_at ASC,last_observed_at DESC,host_key ASC`;

export const EXISTING_RECENT_DAILY_SQL = `SELECT period_key,member_start,member_end,member_growth
FROM sh_daily_summary
WHERE period_key>=? AND period_key<?
ORDER BY period_key ASC`;

const INSERT_DAILY_SUMMARY_SQL = `INSERT INTO sh_daily_summary(
  period_key,period_start,period_end,sample_count,reliable_sample_count,
  listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,
  member_start,member_end,member_growth,likes_max,distinct_tracks,primary_host,
  quality_score,quality_flags,updated_at
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(period_key) DO UPDATE SET
  period_start=CASE
    WHEN sh_daily_summary.period_start IS NULL THEN excluded.period_start
    WHEN excluded.period_start IS NULL THEN sh_daily_summary.period_start
    ELSE MIN(sh_daily_summary.period_start,excluded.period_start)
  END,
  period_end=CASE
    WHEN sh_daily_summary.period_end IS NULL THEN excluded.period_end
    WHEN excluded.period_end IS NULL THEN sh_daily_summary.period_end
    ELSE MAX(sh_daily_summary.period_end,excluded.period_end)
  END,
  sample_count=COALESCE(sh_daily_summary.sample_count,excluded.sample_count),
  reliable_sample_count=COALESCE(sh_daily_summary.reliable_sample_count,excluded.reliable_sample_count),
  listener_avg=COALESCE(sh_daily_summary.listener_avg,excluded.listener_avg),
  listener_min=COALESCE(sh_daily_summary.listener_min,excluded.listener_min),
  listener_max=COALESCE(sh_daily_summary.listener_max,excluded.listener_max),
  stream_start=COALESCE(sh_daily_summary.stream_start,excluded.stream_start),
  stream_end=COALESCE(sh_daily_summary.stream_end,excluded.stream_end),
  stream_growth=COALESCE(sh_daily_summary.stream_growth,excluded.stream_growth),
  member_start=COALESCE(excluded.member_start,sh_daily_summary.member_start),
  member_end=COALESCE(excluded.member_end,sh_daily_summary.member_end),
  member_growth=CASE
    WHEN excluded.member_start IS NOT NULL AND excluded.member_end IS NOT NULL
      THEN excluded.member_end-excluded.member_start
    ELSE sh_daily_summary.member_growth
  END,
  updated_at=excluded.updated_at
WHERE
  sh_daily_summary.period_start IS NOT CASE
    WHEN sh_daily_summary.period_start IS NULL THEN excluded.period_start
    WHEN excluded.period_start IS NULL THEN sh_daily_summary.period_start
    ELSE MIN(sh_daily_summary.period_start,excluded.period_start)
  END
  OR sh_daily_summary.period_end IS NOT CASE
    WHEN sh_daily_summary.period_end IS NULL THEN excluded.period_end
    WHEN excluded.period_end IS NULL THEN sh_daily_summary.period_end
    ELSE MAX(sh_daily_summary.period_end,excluded.period_end)
  END
  OR sh_daily_summary.sample_count IS NOT COALESCE(sh_daily_summary.sample_count,excluded.sample_count)
  OR sh_daily_summary.reliable_sample_count IS NOT COALESCE(sh_daily_summary.reliable_sample_count,excluded.reliable_sample_count)
  OR sh_daily_summary.listener_avg IS NOT COALESCE(sh_daily_summary.listener_avg,excluded.listener_avg)
  OR sh_daily_summary.listener_min IS NOT COALESCE(sh_daily_summary.listener_min,excluded.listener_min)
  OR sh_daily_summary.listener_max IS NOT COALESCE(sh_daily_summary.listener_max,excluded.listener_max)
  OR sh_daily_summary.stream_start IS NOT COALESCE(sh_daily_summary.stream_start,excluded.stream_start)
  OR sh_daily_summary.stream_end IS NOT COALESCE(sh_daily_summary.stream_end,excluded.stream_end)
  OR sh_daily_summary.stream_growth IS NOT COALESCE(sh_daily_summary.stream_growth,excluded.stream_growth)
  OR sh_daily_summary.member_start IS NOT COALESCE(excluded.member_start,sh_daily_summary.member_start)
  OR sh_daily_summary.member_end IS NOT COALESCE(excluded.member_end,sh_daily_summary.member_end)
  OR sh_daily_summary.member_growth IS NOT CASE
    WHEN excluded.member_start IS NOT NULL AND excluded.member_end IS NOT NULL
      THEN excluded.member_end-excluded.member_start
    ELSE sh_daily_summary.member_growth
  END`;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function boundedLookback(value) {
  const parsed = integer(value);
  if (parsed == null || parsed < 1) return DEFAULT_LOOKBACK_DAYS;
  return Math.min(MAX_LOOKBACK_DAYS, parsed);
}

function projectionByDay(rows) {
  const selected = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const dayAt = integer(row?.day_at);
    if (dayAt == null || selected.has(dayAt)) continue;
    selected.set(dayAt, row);
  }
  return selected;
}

function validCounts(row) {
  const sampleCount = integer(row?.sample_count);
  const reliableSampleCount = integer(row?.reliable_sample_count);
  return sampleCount != null
    && sampleCount >= 1
    && sampleCount <= 1_440
    && reliableSampleCount != null
    && reliableSampleCount >= 0
    && reliableSampleCount <= sampleCount;
}

function memberStateKey(channelId, dayAt) {
  return `${channelId}:${dayAt}`;
}

async function loadDailyMemberStates(minuteDb, projections, rangeStart, currentDay) {
  const channelIds = [...new Set([...projections.values()]
    .map((row) => integer(row?.channel_id))
    .filter((value) => value != null && value > 0))];
  const selected = new Map();
  await Promise.all(channelIds.map(async (channelId) => {
    const result = await minuteDb.prepare(RECENT_DAILY_MEMBER_SQL)
      .bind(channelId, rangeStart - DAY_MS, currentDay)
      .all();
    for (const row of result?.results || []) {
      const dayAt = integer(row?.day_at);
      if (dayAt == null) continue;
      const key = memberStateKey(channelId, dayAt);
      if (!selected.has(key)) selected.set(key, row);
    }
  }));
  return selected;
}

function memberBoundaryFromDailyState(memberStates, channelId, dayAt) {
  if (channelId == null || dayAt == null) return null;
  return finite(memberStates.get(memberStateKey(channelId, dayAt))?.last_total_member_count);
}

export async function publishRecentDailySummaries(
  minuteDb,
  otherDb,
  now = Date.now(),
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
) {
  if (!minuteDb?.prepare || !otherDb?.prepare) {
    return { skipped: true, reason: 'db-binding-missing', published: [], unavailable: [] };
  }
  const currentDay = Math.floor(Number(now) / DAY_MS) * DAY_MS;
  if (!Number.isFinite(currentDay)) {
    return { skipped: true, reason: 'invalid-now', published: [], unavailable: [] };
  }
  const days = boundedLookback(lookbackDays);
  const rangeStart = currentDay - days * DAY_MS;
  const existingStart = rangeStart - DAY_MS;
  const [projectionResult, existingResult] = await Promise.all([
    minuteDb.prepare(RECENT_DAILY_PROJECTION_SQL).bind(rangeStart, currentDay).all(),
    otherDb.prepare(EXISTING_RECENT_DAILY_SQL)
      .bind(dayKey(existingStart), dayKey(currentDay))
      .all(),
  ]);
  const projections = projectionByDay(projectionResult?.results || []);
  const existing = new Map((existingResult?.results || []).map((row) => [String(row.period_key), row]));
  const memberStates = await loadDailyMemberStates(minuteDb, projections, rangeStart, currentDay);
  const published = [];
  const unavailable = [];
  const invalid = [];

  for (let dayAt = rangeStart; dayAt < currentDay; dayAt += DAY_MS) {
    const key = dayKey(dayAt);
    const existingRow = existing.get(key);
    const row = projections.get(dayAt);
    if (!row) {
      unavailable.push(key);
      continue;
    }
    if (!validCounts(row)) {
      invalid.push(key);
      continue;
    }
    const channelId = integer(row.channel_id);
    const sampleCount = integer(row.sample_count);
    const reliableSampleCount = integer(row.reliable_sample_count);
    const listenerSum = finite(row.listener_sum);
    const listenerAvg = reliableSampleCount > 0 && listenerSum != null
      ? listenerSum / reliableSampleCount
      : null;
    const streamStart = finite(row.stream_start);
    const streamEnd = finite(row.stream_end);
    // sh_total_member_daily is the sole owner of member boundaries. A missing
    // canonical boundary must not be reconstructed from another projection.
    const memberStart = memberBoundaryFromDailyState(memberStates, channelId, dayAt - DAY_MS);
    const memberEnd = memberBoundaryFromDailyState(memberStates, channelId, dayAt);
    const write = await otherDb.prepare(INSERT_DAILY_SUMMARY_SQL).bind(
      key,
      finite(row.period_start),
      finite(row.period_end),
      sampleCount,
      reliableSampleCount,
      listenerAvg,
      finite(row.listener_min),
      finite(row.listener_max),
      streamStart,
      streamEnd,
      streamStart != null && streamEnd != null && streamEnd >= streamStart
        ? streamEnd - streamStart
        : null,
      memberStart,
      memberEnd,
      memberStart != null && memberEnd != null ? memberEnd - memberStart : null,
      null,
      null,
      null,
      1,
      '["daily_projection_publish"]',
      Number(now),
    ).run();
    if (Number(write?.meta?.changes ?? 1) > 0) {
      published.push(key);
      const nextMemberStart = memberStart ?? finite(existingRow?.member_start);
      const nextMemberEnd = memberEnd ?? finite(existingRow?.member_end);
      const nextMemberGrowth = nextMemberStart != null && nextMemberEnd != null
        ? nextMemberEnd - nextMemberStart
        : finite(existingRow?.member_growth);
      existing.set(key, {
        period_key: key,
        member_start: nextMemberStart,
        member_end: nextMemberEnd,
        member_growth: nextMemberGrowth,
      });
    }
  }

  return {
    skipped: published.length === 0,
    reason: published.length ? null : 'no-recent-summary-repairs-needed',
    published,
    unavailable,
    invalid,
    range: { from: dayKey(rangeStart), to: dayKey(currentDay - DAY_MS) },
  };
}
