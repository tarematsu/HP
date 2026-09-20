const DAY_MS = 86_400_000;
const CACHE_MS = 5 * 60_000;
const cache = { dayStart: null, value: null, expiresAt: 0, pending: null };

export const DAILY_SUMMARY_SQL = `SELECT period_key,stream_growth,member_growth,listener_avg
  FROM sh_daily_summary
  WHERE period_key IN (?,?,?)
  ORDER BY period_key ASC`;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dayText(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function utcDayStarts(now = Date.now()) {
  const currentStart = Math.floor(now / DAY_MS) * DAY_MS;
  return {
    currentStart,
    yesterdayStart: currentStart - DAY_MS,
    dayBeforeYesterdayStart: currentStart - 2 * DAY_MS,
    threeDaysAgoStart: currentStart - 3 * DAY_MS,
  };
}

function summaryFor(byPeriod, start, end) {
  const periodKey = dayText(start);
  const row = byPeriod.get(periodKey);
  return {
    period_key: periodKey,
    start_at: start,
    end_at: end,
    member_growth: finite(row?.member_growth),
    stream_growth: finite(row?.stream_growth),
    listener_avg: finite(row?.listener_avg),
  };
}

export function dashboardDailySummaries(rows, starts) {
  const byPeriod = new Map((Array.isArray(rows) ? rows : [])
    .map((row) => [String(row?.period_key || ''), row])
    .filter(([periodKey]) => periodKey));
  return {
    timezone: 'UTC',
    source: 'sh_daily_summary',
    current_day_start: starts.currentStart,
    yesterday: summaryFor(byPeriod, starts.yesterdayStart, starts.currentStart),
    day_before_yesterday: summaryFor(byPeriod, starts.dayBeforeYesterdayStart, starts.yesterdayStart),
    three_days_ago: summaryFor(byPeriod, starts.threeDaysAgoStart, starts.dayBeforeYesterdayStart),
  };
}

export function resetDashboardDailySummariesCache() {
  cache.dayStart = null;
  cache.value = null;
  cache.expiresAt = 0;
  cache.pending = null;
}

async function readDashboardDailySummaries(db, starts) {
  if (!db) return { ...dashboardDailySummaries([], starts), setup_required: true };
  try {
    const result = await db.prepare(DAILY_SUMMARY_SQL)
      .bind(
        dayText(starts.threeDaysAgoStart),
        dayText(starts.dayBeforeYesterdayStart),
        dayText(starts.yesterdayStart),
      )
      .all();
    return dashboardDailySummaries(result.results || [], starts);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) {
      return { ...dashboardDailySummaries([], starts), setup_required: true };
    }
    throw error;
  }
}

export async function loadDashboardDailySummaries(db, now = Date.now()) {
  const starts = utcDayStarts(now);
  if (cache.dayStart === starts.currentStart && cache.value && cache.expiresAt > now) return cache.value;
  if (cache.dayStart === starts.currentStart && cache.pending) return cache.pending;

  cache.dayStart = starts.currentStart;
  cache.pending = readDashboardDailySummaries(db, starts).then((value) => {
    cache.value = value;
    cache.expiresAt = Date.now() + CACHE_MS;
    return value;
  }).finally(() => {
    cache.pending = null;
  });
  return cache.pending;
}
