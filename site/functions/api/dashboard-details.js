import { augmentDashboardChartData } from '../lib/dashboard-chart-support.js';
import { loadDashboardDailySummaries } from '../lib/dashboard-daily-summaries.js';

const CURRENT_HISTORY_SQL = `SELECT
  bucket_at AS observed_at,
  online_member_count,
  current_stream_count
FROM sh_dashboard_history_5m
WHERE channel_id=? AND bucket_at>=?
ORDER BY bucket_at ASC
LIMIT 300`;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  vary: 'accept-encoding',
};

async function currentHistory(db, channelId, now) {
  if (!db) return [];
  const result = await db.prepare(CURRENT_HISTORY_SQL)
    .bind(channelId, now - 24 * 60 * 60 * 1000)
    .all();
  return result?.results || [];
}

async function dailySummaries(env, now) {
  try {
    return await loadDashboardDailySummaries(env?.OTHER_DB, now);
  } catch (error) {
    console.error(error);
    return loadDashboardDailySummaries(null, now);
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const channelId = Number(url.searchParams.get('channel_id'));
  if (!Number.isFinite(channelId) || channelId <= 0) {
    return new Response(JSON.stringify({ ok: false, error: 'channel_id is required' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const now = Date.now();
  try {
    const [history, summaries] = await Promise.all([
      currentHistory(context.env?.MINUTE_DB, channelId, now),
      dailySummaries(context.env, now),
    ]);
    const chartPayload = await augmentDashboardChartData(
      context.env,
      { ok: true, latest: { channel_id: channelId }, history },
      now,
    );
    return new Response(JSON.stringify({
      ok: true,
      generated_at: now,
      channel_id: channelId,
      history,
      previous_day_history: chartPayload.previous_day_history || [],
      stream_5m_history: chartPayload.stream_5m_history || [],
      daily_summaries: summaries,
    }), { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ ok: false, error: error?.message || 'dashboard details error' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}
