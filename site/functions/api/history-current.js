import {
  currentSummaryPeriodStart,
  minuteSummarySql,
} from '../lib/history-summary.js';
import {
  applySummaryCompleteness,
  currentPeriodKey,
} from '../lib/period-completeness.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=30',
  vary: 'accept-encoding',
};

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

function normalizeMinuteRow(row) {
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
    distinct_tracks: null,
    quality_score: 1,
    quality_flags: '["minute_facts","current_period"]',
    live_collector: true,
  };
}

export async function loadCurrentMinuteSummary(env, mode = 'daily', now = Date.now()) {
  if (mode !== 'daily') throw new Error(`unsupported summary mode: ${mode}`);
  if (!env?.MINUTE_DB) throw new Error('MINUTE_DB binding missing');

  const periodStart = currentSummaryPeriodStart('daily', now);
  const periodKey = currentPeriodKey('daily', now);
  const result = await env.MINUTE_DB.prepare(minuteSummarySql('daily'))
    .bind(periodStart, now + 1, 2)
    .all();
  const liveRows = (result.results || [])
    .map(normalizeMinuteRow)
    .filter((row) => String(row?.period_key || '') === periodKey);
  const completed = applySummaryCompleteness(liveRows, 'daily', now);

  return {
    rows: completed.rows,
    excluded_stream_growth_count: completed.excludedCount,
    boundary_evidence_count: 0,
    live_overlay_count: completed.rows.length,
    latest_live_observed_at: completed.rows.at(-1)?.period_end || null,
    live_truncated: false,
    live_source: 'minute_facts',
    storage_source: 'minute.sh_channel_snapshots',
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
