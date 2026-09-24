import { loadTrackHistoryDayIndex } from './pages-track-history-day-index.js';
import { loadTrackHistoryDayReadModel } from './pages-track-history-r2-shards.js';
import { loadMaterializedR2Response } from './pages-response-r2.js';

const TRACK_HISTORY_MODEL_KEY = 'track-history';
const TRACK_HISTORY_RESPONSE_LIMIT = 20_000;
const TRACK_HISTORY_CACHE_SECONDS = 300;
const ALLOWED_PARAMS = new Set([
  'key', 'api', 'from', 'to', 'limit', 'ranking', 'ranking_limit',
  'ranking_only', 'latest', 'dates_only',
]);

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function responseHeaders(now, readModelUpdatedAt = null) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': `public, max-age=${TRACK_HISTORY_CACHE_SECONDS}, s-maxage=${TRACK_HISTORY_CACHE_SECONDS}`,
    'x-api-source': 'track-history-r2-read-model',
    'x-materialized-at': String(Number(now) || Date.now()),
    'x-materialized-cadence-seconds': String(TRACK_HISTORY_CACHE_SECONDS),
  });
  if (Number.isFinite(Number(readModelUpdatedAt)) && Number(readModelUpdatedAt) > 0) {
    headers.set('x-read-model-updated-at', String(Number(readModelUpdatedAt)));
  }
  return headers;
}

function json(value, status, now, readModelUpdatedAt = null) {
  const headers = responseHeaders(now, readModelUpdatedAt);
  if (status >= 400) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(value), { status, headers });
}

function rankingFromPayload(payload, limit) {
  const fullRanking = Array.isArray(payload?.ranking) ? payload.ranking : [];
  const rows = fullRanking.slice(0, limit);
  const summary = payload?.ranking_summary && typeof payload.ranking_summary === 'object'
    ? payload.ranking_summary
    : {};
  const total = Number(summary?.track_count);
  return {
    rows,
    summary,
    truncated: Number.isFinite(total) ? total > rows.length : fullRanking.length > rows.length,
  };
}

async function loadStatusPayload(r2, now, maximumAgeMs, dependencies) {
  const loadResponse = dependencies.loadStatusResponse || loadMaterializedR2Response;
  // The compact status is available as soon as the cycle finalizes ranking,
  // while the full history can still be backfilling its day objects.
  for (const key of ['track-history-status', TRACK_HISTORY_MODEL_KEY]) {
    const response = await loadResponse(r2, key, now, maximumAgeMs);
    if (!response?.ok) continue;
    const payload = await response.json().catch(() => null);
    if (payload?.ok && Array.isArray(payload.ranking)) return payload;
  }
  return null;
}

function validateParams(url) {
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) return key;
  }
  return null;
}

export async function loadTrackHistoryR2ApiResponse(
  r2,
  request,
  now = Date.now(),
  maximumAgeMs = Number.MAX_SAFE_INTEGER,
  dependencies = {},
) {
  if (typeof r2?.get !== 'function') {
    return json({ ok: false, error: 'track-history R2 binding missing' }, 503, now);
  }
  const url = new URL(request.url);
  const invalidParam = validateParams(url);
  if (invalidParam) {
    return json({ ok: false, error: `unsupported track-history parameter: ${invalidParam}` }, 400, now);
  }

  const rankingLimit = boundedInteger(url.searchParams.get('ranking_limit'), 200, 20, 500);
  if (url.searchParams.get('ranking_only') === '1') {
    const payload = await loadStatusPayload(r2, now, maximumAgeMs, dependencies);
    if (!payload) return json({ ok: false, error: 'track-history ranking read model unavailable' }, 503, now);
    const ranking = rankingFromPayload(payload, rankingLimit);
    return json({
      ok: true,
      mode: 'likes',
      timezone: 'UTC',
      rows: [],
      ranking_included: true,
      ranking: ranking.rows,
      ranking_limit: ranking.rows.length,
      ranking_truncated: ranking.truncated,
      ranking_summary: ranking.summary,
      ranking_scope: payload?.ranking_scope || 'all-time-latest-counter',
      generated_at: payload?.generated_at || ranking.summary.latest_observed_at || null,
      method: 'current_track_like_ranking',
      read_path: 'r2-track-history-status-read-model',
    }, 200, now, payload?.generated_at);
  }

  const loadIndex = dependencies.loadIndex || loadTrackHistoryDayIndex;
  const index = await loadIndex(r2);
  if (!index) {
    return json({ ok: false, error: 'track-history R2 day index unavailable' }, 503, now);
  }
  const dates = Array.isArray(index.dates) ? index.dates.filter(validDate) : [];

  if (url.searchParams.get('dates_only') === '1') {
    return json({
      ok: true,
      mode: 'dates',
      timezone: 'UTC',
      dates,
      latest_date: dates.at(-1) || null,
      read_path: 'r2-track-history-day-index',
    }, 200, now, index.updated_at);
  }

  if (url.searchParams.get('latest') === '1') {
    return json({
      ok: true,
      latest_date: dates.at(-1) || null,
      timezone: 'UTC',
      read_path: 'r2-track-history-day-index',
    }, 200, now, index.updated_at);
  }

  const from = url.searchParams.get('from') || dates[0] || '2024-05-01';
  const to = url.searchParams.get('to') || dates.at(-1) || new Date(now).toISOString().slice(0, 10);
  if (!validDate(from) || !validDate(to) || from > to) {
    return json({ ok: false, error: 'invalid date range' }, 400, now, index.updated_at);
  }
  const limit = boundedInteger(url.searchParams.get('limit'), 10_000, 100, TRACK_HISTORY_RESPONSE_LIMIT);
  const includeRanking = url.searchParams.get('ranking') !== '0';
  const selectedDates = dates.filter((day) => day >= from && day <= to);
  const loadDay = dependencies.loadDay || loadTrackHistoryDayReadModel;
  const rows = [];
  let truncated = false;
  let readModelUpdatedAt = Number(index.updated_at) || 0;

  for (const day of selectedDates) {
    const model = await loadDay(r2, day);
    if (!model) {
      return json({ ok: false, error: `track-history R2 day missing: ${day}` }, 503, now, readModelUpdatedAt);
    }
    readModelUpdatedAt = Math.max(readModelUpdatedAt, Number(model.payload?.updated_at) || 0);
    for (const row of model.payload.rows || []) {
      if (rows.length >= limit) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
    if (truncated) break;
  }

  const metadata = includeRanking
    ? await loadStatusPayload(r2, now, maximumAgeMs, dependencies)
    : {};
  const ranking = includeRanking
    ? rankingFromPayload(metadata, rankingLimit)
    : { rows: [], summary: {}, truncated: false };

  return json({
    ok: true,
    mode: 'tracks',
    from,
    to,
    timezone: 'UTC',
    rows,
    truncated,
    likes_included: true,
    ranking_included: includeRanking,
    ranking: ranking.rows,
    ranking_limit: includeRanking ? ranking.rows.length : 0,
    ranking_truncated: includeRanking && ranking.truncated,
    ranking_summary: ranking.summary,
    ranking_scope: includeRanking ? metadata?.ranking_scope || 'all-time-latest-counter' : null,
    source_row_count: includeRanking ? metadata?.source_row_count || 0 : null,
    excluded_play_count_dates: includeRanking ? metadata?.excluded_play_count_dates || [] : [],
    excluded_play_count_date_count: includeRanking
      ? (metadata?.excluded_play_count_dates || []).length
      : 0,
    generated_at: includeRanking ? metadata?.generated_at || null : null,
    historical_recovery: 'r2-day-read-model',
    method: 'precomputed_track_history_r2_day_read_model',
    read_path: 'r2-track-history-day-read-model',
  }, 200, now, readModelUpdatedAt);
}
