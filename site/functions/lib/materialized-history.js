import { isRealIsoDate } from './api-utils.js';
import { SUMMARY_TABLES } from './history-summary.js';
import {
  applySummaryCompleteness,
  currentPeriodKey,
} from './period-completeness.js';
import { onRequestGet as publicHistory } from '../api/history.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const SUMMARY_COLUMNS = `period_key,period_start,period_end,sample_count,reliable_sample_count,
listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,
member_start,member_end,member_growth,likes_max,distinct_tracks,primary_host,
quality_score,quality_flags`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function todayUtcString(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function summaryLimit(mode) {
  if (mode === 'daily') return 800;
  if (mode === 'weekly') return 160;
  return 60;
}

export async function loadMaterializedSummary(env, mode, from, to, now = Date.now()) {
  if (!env?.OTHER_DB) throw new Error('OTHER_DB binding missing');
  const table = SUMMARY_TABLES[mode];
  if (!table) throw new Error(`unsupported summary mode: ${mode}`);

  // Only the current UTC daily row stays outside R2. It is loaded from
  // /api/history-current and merged in the browser. Weekly and monthly rows,
  // including their current periods when available, are served from R2.
  const currentDailyKey = currentPeriodKey('daily', now);
  const currentFilter = mode === 'daily' ? ' AND period_key<?' : '';
  const statement = env.OTHER_DB.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM ${table}
     WHERE period_key>=? AND period_key<=?${currentFilter}
     ORDER BY period_key ASC LIMIT ?`,
  );
  const bindings = mode === 'daily'
    ? [from, to, currentDailyKey, summaryLimit(mode)]
    : [from, to, summaryLimit(mode)];
  const result = await statement.bind(...bindings).all();
  const rows = result.results || [];
  const completed = applySummaryCompleteness(rows, mode, now);
  return {
    rows: completed.rows,
    excluded_stream_growth_count: completed.excludedCount,
    boundary_evidence_count: 0,
    live_overlay_count: 0,
    latest_live_observed_at: null,
    live_truncated: false,
    live_source: 'summary-only',
    storage_source: `other.${table}`,
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = String(url.searchParams.get('mode') || 'weekly').trim().toLowerCase();
  if (!Object.hasOwn(SUMMARY_TABLES, mode)) {
    return publicHistory({ request, env });
  }

  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const from = fromParam || '2024-06-01';
  const to = toParam || todayUtcString();
  if ((fromParam && !isRealIsoDate(fromParam)) || (toParam && !isRealIsoDate(toParam))) {
    return json({ ok: false, error: 'from and to must be valid YYYY-MM-DD dates' }, 400);
  }
  if (from > to) return json({ ok: false, error: 'from must not be after to' }, 400);

  try {
    const summary = await loadMaterializedSummary(env, mode, from, to);
    return json({ ok: true, mode, from, to, timezone: 'UTC', ...summary });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'materialized history error' }, 500);
  }
}
