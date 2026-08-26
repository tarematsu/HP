import { isRealIsoDate } from '../lib/api-utils.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=7200',
  vary: 'accept-encoding',
};
const MAX_POINTS = 120000;
const SERIES_CACHE_TTL_MS = 5 * 60 * 1000;
const SERIES_CACHE_MAX = 8;
const SERIES_CACHE_VERSION = 5;
const DUPLICATE_START_TOLERANCE_MS = 15 * 60 * 1000;
const DUPLICATE_NAME_TOLERANCE_MS = 6 * 60 * 60 * 1000;
const sakurazakaSeriesCache = new Map();

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: status === 200 ? JSON_HEADERS : { ...JSON_HEADERS, 'cache-control': 'no-store' },
});

function dateParam(value, fallback) {
  return isRealIsoDate(value) ? value : fallback;
}
function parseDateStart(value) { return Date.parse(`${value}T00:00:00Z`); }
function addDays(timestamp, days) { return timestamp + days * 86400000; }
function todayUtcString() { return new Date().toISOString().slice(0, 10); }

export async function cachedSakurazakaSeries(key, loader, now = Date.now()) {
  const cached = sakurazakaSeriesCache.get(key);
  if (cached?.expiresAt > now && Object.hasOwn(cached, 'value')) {
    sakurazakaSeriesCache.delete(key);
    sakurazakaSeriesCache.set(key, cached);
    return cached.value;
  }
  if (cached?.pending) return cached.pending;

  const entry = cached || {};
  entry.pending = Promise.resolve().then(loader).then((value) => {
    entry.value = value;
    entry.expiresAt = Date.now() + SERIES_CACHE_TTL_MS;
    return value;
  }).catch((error) => {
    sakurazakaSeriesCache.delete(key);
    throw error;
  }).finally(() => { entry.pending = null; });
  sakurazakaSeriesCache.set(key, entry);
  while (sakurazakaSeriesCache.size > SERIES_CACHE_MAX) {
    sakurazakaSeriesCache.delete(sakurazakaSeriesCache.keys().next().value);
  }
  return entry.pending;
}

export function resetSakurazakaSeriesCache() {
  sakurazakaSeriesCache.clear();
}

export const SAKURAZAKA_EVENT_SQL = `SELECT event_name,started_at,ended_at
FROM sh_official_broadcast_summary
WHERE host_handle='sakurazaka46jp' AND started_at>=? AND started_at<?
ORDER BY started_at ASC`;

export const SAKURAZAKA_MINUTE_SERIES_SQL = `WITH target_host AS (
  SELECT id FROM sh_hosts
  WHERE lower(COALESCE(current_handle,''))='sakurazaka46jp'
  LIMIT 1
), target_sessions AS (
  SELECT s.id
  FROM target_host h
  CROSS JOIN sh_broadcast_sessions s
  WHERE s.host_id=h.id
), candidate_points AS (
  SELECT f.minute_at,f.listener_count
  FROM target_sessions target
  CROSS JOIN sh_minute_facts f
  WHERE f.broadcast_session_id=target.id
    AND f.minute_at>=?2 AND f.minute_at<?3
    AND f.listener_count IS NOT NULL
  UNION ALL
  SELECT f.minute_at,f.listener_count
  FROM target_host h
  CROSS JOIN sh_minute_fact_context_v2 c
  JOIN sh_minute_facts f ON f.id=c.fact_id
  WHERE c.host_id_override=h.id
    AND f.broadcast_session_id IS NULL
    AND f.minute_at>=?2 AND f.minute_at<?3
    AND f.listener_count IS NOT NULL
), minute_points AS (
  SELECT CAST((minute_at-?1)/60000 AS INTEGER) AS elapsed_minute,
    ROUND(AVG(listener_count),1) AS listener_count,COUNT(*) AS source_samples
  FROM candidate_points
  GROUP BY elapsed_minute
), ranked AS (
  SELECT *,ROW_NUMBER() OVER (ORDER BY elapsed_minute ASC) AS point_rank,
    COUNT(*) OVER () AS total_points
  FROM minute_points
), ordered AS (
  SELECT elapsed_minute,listener_count,source_samples,total_points
  FROM ranked WHERE point_rank<=${MAX_POINTS}
  ORDER BY elapsed_minute ASC
)
SELECT json_group_array(json_array(elapsed_minute,listener_count,source_samples)) AS points_json,
  COUNT(*) AS point_count,COALESCE(MAX(total_points),0) AS total_points
FROM ordered`;

export const SAKURAZAKA_FAILSAFE_SERIES_SQL = `WITH minute_points AS (
  SELECT
    'news:' || announcements.id AS series_key,
    announcements.event_name AS event_name,
    COALESCE(announcements.first_broadcast_at,announcements.scheduled_at) AS started_at,
    CAST((probes.observed_at - COALESCE(announcements.first_broadcast_at,announcements.scheduled_at)) / 60000 AS INTEGER) AS elapsed_minute,
    ROUND(AVG(probes.listener_count), 1) AS listener_count,
    COUNT(*) AS source_samples
  FROM sh_official_news_announcements announcements
  JOIN sh_official_news_station_probes probes ON probes.announcement_id=announcements.id
  WHERE COALESCE(announcements.first_broadcast_at,announcements.scheduled_at)>=?
    AND COALESCE(announcements.first_broadcast_at,announcements.scheduled_at)<?
    AND probes.is_broadcasting=1
    AND probes.listener_count IS NOT NULL
  GROUP BY announcements.id,announcements.event_name,started_at,elapsed_minute
), ranked AS (
  SELECT *,ROW_NUMBER() OVER (ORDER BY started_at ASC,elapsed_minute ASC) AS point_rank,
    COUNT(*) OVER () AS total_points
  FROM minute_points
), ordered AS (
  SELECT series_key,event_name,started_at,elapsed_minute,listener_count,source_samples,total_points
  FROM ranked WHERE point_rank<=${MAX_POINTS}
  ORDER BY started_at ASC,elapsed_minute ASC
)
SELECT series_key,event_name,started_at,
  json_group_array(json_array(elapsed_minute,listener_count,source_samples)) AS points_json,
  COUNT(*) AS point_count,MAX(total_points) AS total_points
FROM ordered
GROUP BY series_key,event_name,started_at
ORDER BY started_at ASC`;

export function decodeSakurazakaSeriesRows(rows, source) {
  const result = [];
  for (const row of rows || []) {
    let encoded = [];
    try {
      const parsed = JSON.parse(row.points_json || '[]');
      if (Array.isArray(parsed)) encoded = parsed;
    } catch {}
    const samples = [];
    for (const point of encoded) {
      const listener = Number(point?.[1]);
      if (!Number.isFinite(listener)) continue;
      samples.push({
        elapsed: Number(point?.[0]) || 0,
        listener,
        sourceSamples: Number(point?.[2]) || 0,
      });
    }
    result.push({
      series_key: String(row.series_key || `${row.event_name}:${row.started_at}`),
      event_name: String(row.event_name || '公式ステヘ'),
      started_at: Number(row.started_at) || null,
      samples,
      source,
      sourceTruncated: Number(row.total_points || 0) > MAX_POINTS,
    });
  }
  return result;
}

function normalizedEventName(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function hasSeriesSamples(row) {
  return Array.isArray(row?.samples) && row.samples.length > 0;
}

function genericEventName(value) {
  const name = normalizedEventName(value);
  return !name || name === '公式ステヘ';
}

function similarEventNames(leftValue, rightValue) {
  const left = normalizedEventName(leftValue);
  const right = normalizedEventName(rightValue);
  if (!left || !right) return false;
  if (left === right) return true;
  return Math.min(left.length, right.length) >= 4 && (left.includes(right) || right.includes(left));
}

function duplicateSeries(primary, fallback) {
  const primaryStart = Number(primary?.started_at);
  const fallbackStart = Number(fallback?.started_at);
  const startsAvailable = Number.isFinite(primaryStart) && Number.isFinite(fallbackStart);
  const startDifference = startsAvailable ? Math.abs(primaryStart - fallbackStart) : Infinity;
  const namesMatch = similarEventNames(primary?.event_name, fallback?.event_name);
  const genericName = genericEventName(primary?.event_name) || genericEventName(fallback?.event_name);

  if (startDifference <= DUPLICATE_START_TOLERANCE_MS && (namesMatch || genericName)) return true;
  if (!namesMatch) return false;
  return !startsAvailable || startDifference <= DUPLICATE_NAME_TOLERANCE_MS;
}

export function mergeSakurazakaSeriesRows(primaryRows, fallbackRows) {
  const primary = (Array.isArray(primaryRows) ? primaryRows : []).filter(hasSeriesSamples);
  const merged = [...primary];
  for (const fallback of Array.isArray(fallbackRows) ? fallbackRows : []) {
    if (!hasSeriesSamples(fallback)) continue;
    if (!primary.some((item) => duplicateSeries(item, fallback))) merged.push(fallback);
  }
  return merged;
}

export function countSakurazakaMissingSummaries(historicalRows, summaryCount) {
  const available = (Array.isArray(historicalRows) ? historicalRows : []).filter(hasSeriesSamples).length;
  return Math.max(0, Math.max(0, Number(summaryCount) || 0) - available);
}

export function trimSakurazakaSeries(seriesRows, limit = MAX_POINTS) {
  const ordered = [...seriesRows].sort((a, b) => (a.started_at || 0) - (b.started_at || 0));
  const result = [];
  let remaining = limit;
  let originalPoints = 0;
  let sourceTruncated = false;
  for (const row of ordered) {
    const samples = Array.isArray(row.samples) ? row.samples : [];
    originalPoints += samples.length;
    sourceTruncated ||= Boolean(row.sourceTruncated);
    if (remaining <= 0 || !samples.length) continue;
    const take = Math.min(samples.length, remaining);
    const points = new Array(take);
    let sourceSamples = 0;
    for (let index = 0; index < take; index += 1) {
      const point = samples[index];
      points[index] = [point.elapsed, point.listener];
      sourceSamples += point.sourceSamples;
    }
    remaining -= take;
    result.push({
      event_name: row.event_name,
      started_at: row.started_at,
      points,
      source_samples: sourceSamples,
      source: row.source,
    });
  }
  return { series: result, pointCount: limit - remaining, truncated: sourceTruncated || originalPoints > limit };
}

export async function loadSakurazakaSeriesRows(minuteDb, otherDb, fromTs, toTs) {
  const historicalRows = [];
  const summaryResult = await otherDb.prepare(SAKURAZAKA_EVENT_SQL).bind(fromTs, toTs).all();
  const summaries = summaryResult.results || [];
  for (const summary of summaries) {
    const start = Number(summary.started_at || 0);
    const end = Number(summary.ended_at || start) + 60_000;
    const pointsResult = await minuteDb.prepare(SAKURAZAKA_MINUTE_SERIES_SQL)
      .bind(start, start, end).all();
    const points = pointsResult.results?.[0] || {};
    historicalRows.push({
      series_key: `historical:${summary.event_name}`,
      event_name: summary.event_name,
      started_at: summary.started_at,
      points_json: points.points_json || '[]',
      point_count: points.point_count || 0,
      total_points: points.total_points || 0,
    });
  }
  let failSafeRows = [];
  try {
    const failSafeResult = await otherDb.prepare(SAKURAZAKA_FAILSAFE_SERIES_SQL).bind(fromTs, toTs).all();
    failSafeRows = failSafeResult.results || [];
  } catch (error) {
    if (!/no such table/i.test(String(error?.message || ''))) throw error;
  }
  return {
    historical: decodeSakurazakaSeriesRows(historicalRows, 'historical_import'),
    failSafe: decodeSakurazakaSeriesRows(failSafeRows, 'official_news_fail_safe'),
    summaryCount: summaries.length,
  };
}

async function loadSakurazakaSeries(env, from, to) {
  const fromTs = parseDateStart(from);
  const toTs = addDays(parseDateStart(to), 1);
  const { historical, failSafe, summaryCount } = await loadSakurazakaSeriesRows(
    env.MINUTE_DB,
    env.OTHER_DB,
    fromTs,
    toTs,
  );
  const merged = mergeSakurazakaSeriesRows(historical, failSafe);
  const trimmed = trimSakurazakaSeries(merged);
  const historicalSeriesCount = historical.filter(hasSeriesSamples).length;
  let failSafeEventCount = 0;
  for (const item of trimmed.series) {
    if (item.source === 'official_news_fail_safe') failSafeEventCount += 1;
  }
  return {
    ok: true,
    subject: 'sakurazaka46jp',
    from,
    to,
    timezone: 'UTC',
    series: trimmed.series,
    event_count: trimmed.series.length,
    summary_event_count: summaryCount,
    historical_series_count: historicalSeriesCount,
    missing_series_count: countSakurazakaMissingSummaries(historical, summaryCount),
    point_count: trimmed.pointCount,
    fail_safe_event_count: failSafeEventCount,
    truncated: trimmed.truncated,
    x_origin: 'broadcast_start',
    x_unit: 'minute',
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.OTHER_DB || !env.MINUTE_DB) return json({ ok: false, error: 'history database bindings missing' }, 500);
  try {
    const url = new URL(request.url);
    const today = todayUtcString();
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');
    if ((fromParam && !isRealIsoDate(fromParam)) || (toParam && !isRealIsoDate(toParam))) {
      return json({ ok: false, error: 'from and to must be valid YYYY-MM-DD dates' }, 400);
    }
    const from = dateParam(fromParam, '2024-05-01');
    const to = dateParam(toParam, today);
    if (from > to) return json({ ok: false, error: 'from must not be after to' }, 400);
    const payload = await cachedSakurazakaSeries(
      `sakurazaka46jp:v${SERIES_CACHE_VERSION}:${from}:${to}`,
      () => loadSakurazakaSeries(env, from, to),
    );
    return json(payload);
  } catch (error) {
    return json({ ok: false, error: error?.message || 'sakurazaka46jp series error' }, 500);
  }
}