import { isRealIsoDate } from './api-utils.mjs';
import {
  previousSummaryPeriodKey,
  SUMMARY_TABLES,
} from './history-summary-contract.mjs';
import {
  applySummaryCompleteness,
  loadSummaryDailyCoverage,
  currentPeriodKey,
} from './period-completeness.mjs';
import {
  isKnownMissingPeriod,
  materializeKnownMissingPeriods,
} from './known-history-gap.mjs';

const MAX_DAILY_MINUTE_SAMPLES = 1_440;
const TRACK_HISTORY_DAY_INDEX_KEY = 'track-history-days/v1/index.json';
const SUMMARY_COLUMNS = `period_key,period_start,period_end,sample_count,reliable_sample_count,
listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,
member_start,member_end,member_growth,likes_max,distinct_tracks,primary_host,
quality_score,quality_flags`;

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summaryLimit(mode) {
  if (mode === 'daily') return 800;
  if (mode === 'weekly') return 160;
  return 60;
}

function validateDailySummaryRows(rows) {
  for (const row of rows) {
    const sampleCount = Number(row?.sample_count);
    const reliableSampleCount = Number(row?.reliable_sample_count);
    if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > MAX_DAILY_MINUTE_SAMPLES) {
      throw new Error(`daily summary ${row?.period_key || 'unknown'} has invalid sample_count: ${row?.sample_count}`);
    }
    if (!Number.isInteger(reliableSampleCount)
        || reliableSampleCount < 0
        || reliableSampleCount > sampleCount) {
      throw new Error(`daily summary ${row?.period_key || 'unknown'} has invalid reliable_sample_count: ${row?.reliable_sample_count}`);
    }
  }
  return rows;
}

function trackPeriodKey(mode, day) {
  if (mode === 'daily') return day;
  if (mode === 'monthly') return day.slice(0, 7);
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  const date = new Date(timestamp);
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(timestamp - offset * 86_400_000).toISOString().slice(0, 10);
}

async function objectJson(object) {
  if (!object) return null;
  if (typeof object.json === 'function') return object.json();
  if (typeof object.text === 'function') return JSON.parse(await object.text());
  return null;
}

function aggregateTrackCounts(mode, rows) {
  const totals = new Map();
  for (const row of rows || []) {
    const day = String(row?.play_date || '');
    if (!isRealIsoDate(day)) continue;
    const count = finiteNumber(row?.play_count);
    if (count == null) continue;
    const key = trackPeriodKey(mode, day);
    totals.set(key, (totals.get(key) || 0) + count);
  }
  return totals;
}

async function loadTrackCountsFromR2(r2, mode, from, to) {
  const payload = await objectJson(await r2.get(TRACK_HISTORY_DAY_INDEX_KEY));
  if (!payload || Number(payload.version) !== 1 || !Array.isArray(payload.dates)) return new Map();
  const counts = payload.play_counts && typeof payload.play_counts === 'object'
    ? payload.play_counts
    : {};
  const rows = payload.dates
    .map(String)
    .filter((day) => isRealIsoDate(day) && day >= from && day <= to)
    .map((day) => ({ play_date: day, play_count: counts[day] }))
    .filter((row) => finiteNumber(row.play_count) != null);
  return aggregateTrackCounts(mode, rows);
}

async function loadTrackCountsFromService(service, mode, from, to) {
  const url = new URL('https://pages-read-model.internal/_internal/pages-response');
  url.searchParams.set('key', 'track-history');
  url.searchParams.set('api', '1');
  url.searchParams.set('counts_only', '1');
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  const response = await service.fetch(new Request(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  }));
  if (!response?.ok) return new Map();
  const payload = await response.json().catch(() => null);
  if (!payload?.ok || !Array.isArray(payload.rows)) return new Map();
  return aggregateTrackCounts(mode, payload.rows);
}

export async function loadPeriodTrackCounts(env, mode, from, to) {
  if (typeof env?.PAGES_RESPONSE_R2?.get === 'function') {
    return loadTrackCountsFromR2(env.PAGES_RESPONSE_R2, mode, from, to);
  }
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch === 'function') {
    return loadTrackCountsFromService(service, mode, from, to);
  }
  return new Map();
}

export async function loadMaterializedSummary(env, mode, from, to, now = Date.now()) {
  if (!env?.OTHER_DB) throw new Error('OTHER_DB binding missing');
  const table = SUMMARY_TABLES[mode];
  if (!table) throw new Error(`unsupported summary mode: ${mode}`);

  const currentKey = currentPeriodKey(mode, now);
  const currentFilter = mode === 'daily' ? ' AND period_key<?' : '';
  const previousDailyKey = mode === 'daily' ? previousSummaryPeriodKey('daily', from) : null;
  const queryFrom = previousDailyKey || from;
  const queryLimit = summaryLimit(mode) + (mode === 'daily' && queryFrom < from ? 1 : 0);
  const statement = env.OTHER_DB.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM ${table}
     WHERE period_key>=? AND period_key<=?${currentFilter}
     ORDER BY period_key ASC LIMIT ?`,
  );
  const bindings = mode === 'daily'
    ? [queryFrom, to, currentKey, queryLimit]
    : [from, to, queryLimit];
  const result = await statement.bind(...bindings).all();
  const fetchedRows = result.results || [];
  if (mode === 'daily') validateDailySummaryRows(fetchedRows);
  const rows = mode === 'daily'
    ? fetchedRows.filter((row) => String(row?.period_key || '') >= from)
    : fetchedRows;

  const trackCountSourceAvailable = typeof env?.PAGES_RESPONSE_R2?.get === 'function'
    || typeof env?.PAGES_READ_MODEL_SERVICE?.fetch === 'function';
  const shouldLoadTrackCounts = trackCountSourceAvailable && rows.some((row) => {
    const key = String(row?.period_key || '');
    if (isKnownMissingPeriod(mode, key)) return false;
    return key === currentKey || (key < currentKey && finiteNumber(row?.distinct_tracks) == null);
  });
  const trackCounts = shouldLoadTrackCounts
    ? await loadPeriodTrackCounts(env, mode, from, to)
    : new Map();

  const dailyCoverage = await loadSummaryDailyCoverage(env.OTHER_DB, rows, mode);
  const completed = applySummaryCompleteness(rows, mode, now, dailyCoverage);
  const enrichedRows = completed.rows.map((row) => {
    const key = String(row?.period_key || '');
    const calculated = finiteNumber(trackCounts.get(key));
    if (key === currentKey && calculated != null) return { ...row, distinct_tracks: calculated };
    if (finiteNumber(row?.distinct_tracks) == null && calculated != null) return { ...row, distinct_tracks: calculated };
    return row;
  });
  return {
    rows: materializeKnownMissingPeriods(enrichedRows, mode, from, to, now),
    excluded_stream_growth_count: completed.excludedCount,
    boundary_evidence_count: 0,
    live_overlay_count: 0,
    latest_live_observed_at: null,
    live_truncated: false,
    live_source: 'summary-only',
    storage_source: shouldLoadTrackCounts
      ? `other.${table}+r2.track-history-days`
      : `other.${table}`,
  };
}
