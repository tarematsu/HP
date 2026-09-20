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
const MAX_DAILY_MINUTE_SAMPLES = 1_440;

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

function trackPeriodExpression(mode) {
  if (mode === 'daily') return 'play_date';
  if (mode === 'monthly') return "substr(play_date,1,7)";
  return "date(play_date,'-' || ((CAST(strftime('%w',play_date) AS INTEGER)+6)%7) || ' days')";
}

export async function loadPeriodTrackCounts(env, mode, from, to) {
  if (!env?.MINUTE_DB?.prepare) return new Map();
  const periodExpression = trackPeriodExpression(mode);
  try {
    const result = await env.MINUTE_DB.prepare(`SELECT ${periodExpression} AS period_key,
        SUM(CASE
          WHEN CAST(json_extract(row_json,'$.play_count') AS INTEGER)>0
            THEN CAST(json_extract(row_json,'$.play_count') AS INTEGER)
          ELSE 1
        END) AS track_count
      FROM sh_pages_track_history_read_model
      WHERE play_date>=? AND play_date<=?
      GROUP BY ${periodExpression}
      ORDER BY period_key ASC`)
      .bind(from, to)
      .all();
    return new Map((result.results || []).map((row) => [
      String(row.period_key || ''),
      Number.isFinite(Number(row.track_count)) ? Number(row.track_count) : null,
    ]));
  } catch (error) {
    if (/no such table|no such function|malformed json/i.test(String(error?.message || error))) return new Map();
    throw error;
  }
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
  const hasTrackReadModel = Boolean(env?.MINUTE_DB?.prepare);
  const [result, trackCounts] = await Promise.all([
    statement.bind(...bindings).all(),
    loadPeriodTrackCounts(env, mode, from, to),
  ]);
  const rows = result.results || [];
  if (mode === 'daily') validateDailySummaryRows(rows);
  const completed = applySummaryCompleteness(rows, mode, now);
  const enrichedRows = completed.rows.map((row) => {
    const key = String(row?.period_key || '');
    const calculated = trackCounts.get(key);
    return calculated == null ? row : { ...row, distinct_tracks: calculated };
  });
  return {
    rows: enrichedRows,
    excluded_stream_growth_count: completed.excludedCount,
    boundary_evidence_count: 0,
    live_overlay_count: 0,
    latest_live_observed_at: null,
    live_truncated: false,
    live_source: 'summary-only',
    storage_source: hasTrackReadModel
      ? `other.${table}+minute.sh_pages_track_history_read_model`
      : `other.${table}`,
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
