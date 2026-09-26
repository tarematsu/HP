const DAY_MS = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_LOOKBACK_DAYS = 45;

export const RECENT_DAILY_PROJECTION_SQL = `SELECT
  channel_id,day_at,period_start,period_end,sample_count,reliable_sample_count,
  listener_sum,listener_min,listener_max,stream_start,stream_end,member_end,updated_at
FROM sh_current_daily_summary
WHERE day_at>=? AND day_at<?
ORDER BY day_at ASC,sample_count DESC,period_end DESC,channel_id ASC`;

export const EXISTING_RECENT_DAILY_SQL = `SELECT period_key,member_end
FROM sh_daily_summary
WHERE period_key>=? AND period_key<?
ORDER BY period_key ASC`;

const INSERT_DAILY_SUMMARY_SQL = `INSERT INTO sh_daily_summary(
  period_key,period_start,period_end,sample_count,reliable_sample_count,
  listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,
  member_start,member_end,member_growth,likes_max,distinct_tracks,primary_host,
  quality_score,quality_flags,updated_at
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(period_key) DO NOTHING`;

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

function memberEndFromProjectionOrSummary(dayAt, projections, existing) {
  const previousDayAt = dayAt - DAY_MS;
  const projected = finite(projections.get(previousDayAt)?.member_end);
  if (projected != null) return projected;
  return finite(existing.get(dayKey(previousDayAt))?.member_end);
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
  const published = [];
  const unavailable = [];
  const invalid = [];

  for (let dayAt = rangeStart; dayAt < currentDay; dayAt += DAY_MS) {
    const key = dayKey(dayAt);
    if (existing.has(key)) continue;
    const row = projections.get(dayAt);
    if (!row) {
      unavailable.push(key);
      continue;
    }
    if (!validCounts(row)) {
      invalid.push(key);
      continue;
    }
    const sampleCount = integer(row.sample_count);
    const reliableSampleCount = integer(row.reliable_sample_count);
    const listenerSum = finite(row.listener_sum);
    const listenerAvg = reliableSampleCount > 0 && listenerSum != null
      ? listenerSum / reliableSampleCount
      : null;
    const streamStart = finite(row.stream_start);
    const streamEnd = finite(row.stream_end);
    const memberStart = memberEndFromProjectionOrSummary(dayAt, projections, existing);
    const memberEnd = finite(row.member_end);
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
      existing.set(key, { period_key: key, member_end: memberEnd });
    }
  }

  return {
    skipped: published.length === 0,
    reason: published.length ? null : 'no-missing-projected-days',
    published,
    unavailable,
    invalid,
    range: { from: dayKey(rangeStart), to: dayKey(currentDay - DAY_MS) },
  };
}
