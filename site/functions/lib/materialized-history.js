import { isRealIsoDate } from './api-utils.js';
import {
  previousSummaryPeriodKey,
  SUMMARY_TABLES,
} from './history-summary.js';
import {
  applySummaryCompleteness,
  loadSummaryDailyCoverage,
  currentPeriodKey,
} from './period-completeness.js';
import {
  isKnownMissingPeriod,
  materializeKnownMissingPeriods,
} from './known-history-gap.js';
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

async function persistClosedPeriodTrackCounts(db, table, rows, trackCounts, mode, now) {
  if (!db?.prepare || !trackCounts?.size) return 0;
  const currentKey = currentPeriodKey(mode, now);
  const statements = [];
  for (const row of rows) {
    const key = String(row?.period_key || '');
    if (!key || key >= currentKey || isKnownMissingPeriod(mode, key) || finiteNumber(row?.distinct_tracks) != null) continue;
    const count = finiteNumber(trackCounts.get(key));
    if (count == null) continue;
    statements.push(db.prepare(`UPDATE ${table}
      SET distinct_tracks=?,updated_at=?
      WHERE period_key=? AND distinct_tracks IS NULL`)
      .bind(count, now, key));
  }
  if (!statements.length) return 0;
  if (typeof db.batch === 'function') {
    await db.batch(statements);
  } else {
    for (const statement of statements) await statement.run();
  }
  return statements.length;
}

export async function loadMaterializedSummary(env, mode, from, to, now = Date.now()) {
  if (!env?.OTHER_DB) throw new Error('OTHER_DB binding missing');
  const table = SUMMARY_TABLES[mode];
  if (!table) throw new Error(`unsupported summary mode: ${mode}`);

  // Keep one prior daily row in the bounded read for compatibility with the
  // existing materialization contract. Persisted member metrics are not
  // recalculated from it; the requested range is filtered before rendering.
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

  // Historical track totals are canonical summary data. Calculate them only
  // when a closed period has not been populated yet, persist the result to
  // OTHER_DB, and read the stored value on subsequent materializations. Known
  // missing periods are display-only read-model rows and must never trigger D1
  // writes. The current weekly/monthly period remains live because it changes.
  const shouldLoadTrackCounts = Boolean(env?.MINUTE_DB?.prepare) && rows.some((row) => {
    const key = String(row?.period_key || '');
    if (isKnownMissingPeriod(mode, key)) return false;
    return key === currentKey || (key < currentKey && finiteNumber(row?.distinct_tracks) == null);
  });
  const trackCounts = shouldLoadTrackCounts
    ? await loadPeriodTrackCounts(env, mode, from, to)
    : new Map();
  await persistClosedPeriodTrackCounts(env.OTHER_DB, table, rows, trackCounts, mode, now);

  const dailyCoverage = await loadSummaryDailyCoverage(env.OTHER_DB, rows, mode);
  const completed = applySummaryCompleteness(rows, mode, now, dailyCoverage);
  const enrichedRows = completed.rows.map((row) => {
    const key = String(row?.period_key || '');
    const calculated = finiteNumber(trackCounts.get(key));
    if (key === currentKey && calculated != null) return { ...row, distinct_tracks: calculated };
    if (finiteNumber(row?.distinct_tracks) == null && calculated != null) {
      return { ...row, distinct_tracks: calculated };
    }
    return row;
  });
  return {
    rows: materializeKnownMissingPeriods(enrichedRows, mode, from, to),
    excluded_stream_growth_count: completed.excludedCount,
    boundary_evidence_count: 0,
    live_overlay_count: 0,
    latest_live_observed_at: null,
    live_truncated: false,
    live_source: 'summary-only',
    storage_source: shouldLoadTrackCounts
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
