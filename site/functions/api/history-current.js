import { CURRENT_DAILY_MINUTE_SUMMARY_SQL } from '../lib/current-minute-summary.js';
import { currentSummaryPeriodStart } from '../lib/history-summary.js';
import {
  applySummaryCompleteness,
  currentPeriodKey,
} from '../lib/period-completeness.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=30',
  vary: 'accept-encoding',
};
const MAX_DAILY_MINUTE_SAMPLES = 1_440;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMinuteRow(row, trackCount = null) {
  const streamStart = finiteNumber(row?.stream_start);
  const streamEnd = finiteNumber(row?.stream_end);
  const memberStart = finiteNumber(row?.member_start);
  const memberEnd = finiteNumber(row?.member_end);
  return {
    ...row,
    stream_growth: streamStart != null && streamEnd != null && streamEnd >= streamStart
      ? streamEnd - streamStart
      : null,
    member_growth: memberStart != null && memberEnd != null
      ? memberEnd - memberStart
      : null,
    likes_max: null,
    distinct_tracks: trackCount,
    quality_score: 1,
    quality_flags: '["minute_facts","current_period"]',
    live_collector: true,
  };
}

async function loadCurrentTrackCount(db, periodKey) {
  try {
    const row = await db.prepare(`SELECT
        SUM(CASE
          WHEN CAST(json_extract(row_json,'$.play_count') AS INTEGER)>0
            THEN CAST(json_extract(row_json,'$.play_count') AS INTEGER)
          ELSE 1
        END) AS track_count
      FROM sh_pages_track_history_read_model
      WHERE play_date=?`)
      .bind(periodKey)
      .first();
    const value = Number(row?.track_count);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    if (/no such table|no such function|malformed json/i.test(String(error?.message || error))) return null;
    throw error;
  }
}

function validateDailyMinuteRow(row) {
  const sampleCount = Number(row?.sample_count);
  const reliableSampleCount = Number(row?.reliable_sample_count);
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > MAX_DAILY_MINUTE_SAMPLES) {
    throw new Error(`current daily sample_count is invalid: ${row?.sample_count}`);
  }
  if (!Number.isInteger(reliableSampleCount)
      || reliableSampleCount < 0
      || reliableSampleCount > sampleCount) {
    throw new Error(`current daily reliable_sample_count is invalid: ${row?.reliable_sample_count}`);
  }
  return row;
}

export async function loadCurrentMinuteSummary(env, mode = 'daily', now = Date.now()) {
  if (mode !== 'daily') throw new Error(`unsupported summary mode: ${mode}`);
  if (!env?.MINUTE_DB) throw new Error('MINUTE_DB binding missing');

  const periodStart = currentSummaryPeriodStart('daily', now);
  const periodKey = currentPeriodKey('daily', now);
  const [result, trackCount] = await Promise.all([
    env.MINUTE_DB.prepare(CURRENT_DAILY_MINUTE_SUMMARY_SQL)
      .bind(periodStart, now + 1, 2)
      .all(),
    loadCurrentTrackCount(env.MINUTE_DB, periodKey),
  ]);
  const liveRows = (result.results || [])
    .map((row) => normalizeMinuteRow(row, trackCount))
    .filter((row) => String(row?.period_key || '') === periodKey)
    .map(validateDailyMinuteRow);
  const completed = applySummaryCompleteness(liveRows, 'daily', now);

  return {
    rows: completed.rows,
    excluded_stream_growth_count: completed.excludedCount,
    boundary_evidence_count: 0,
    live_overlay_count: completed.rows.length,
    latest_live_observed_at: completed.rows.at(-1)?.period_end || null,
    live_truncated: false,
    live_source: 'minute_facts',
    storage_source: 'minute.sh_minute_facts+minute.sh_pages_track_history_read_model',
    read_path: 'minute-current-daily',
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = String(url.searchParams.get('mode') || 'daily').trim().toLowerCase();
  if (mode !== 'daily') {
    return json({ ok: false, error: `unsupported history mode: ${mode}` }, 400, {
      'cache-control': 'no-store',
    });
  }

  try {
    const now = Date.now();
    const summary = await loadCurrentMinuteSummary(env, 'daily', now);
    return json({
      ok: true,
      mode: 'daily',
      period_key: currentPeriodKey('daily', now),
      timezone: 'UTC',
      ...summary,
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'current history error' }, 500, {
      'cache-control': 'no-store',
    });
  }
}
