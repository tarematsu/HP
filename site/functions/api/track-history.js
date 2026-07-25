const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: status >= 400 ? { ...HEADERS, 'cache-control': 'no-store' } : HEADERS,
});

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env }) {
  if (!env?.MINUTE_DB) return json({ ok: false, error: 'MINUTE_DB binding missing' }, 500);
  const url = new URL(request.url);

  try {
    if (url.searchParams.get('latest') === '1') {
      const latest = await env.MINUTE_DB.prepare(`SELECT MAX(play_date) AS play_date
        FROM sh_pages_track_history_read_model`).first();
      return json({ ok: true, latest_date: latest?.play_date || null, timezone: 'UTC' });
    }

    const from = url.searchParams.get('from') || '2024-05-01';
    const to = url.searchParams.get('to') || today();
    if (!validDate(from) || !validDate(to) || from > to) {
      return json({ ok: false, error: 'invalid date range' }, 400);
    }
    const requestedLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.max(Math.trunc(requestedLimit), 100), 20_000)
      : 10_000;
    const includeRanking = url.searchParams.get('ranking') !== '0';
    const requestedRankingLimit = Number(url.searchParams.get('ranking_limit'));
    const rankingLimit = Number.isFinite(requestedRankingLimit) && requestedRankingLimit > 0
      ? Math.min(Math.max(Math.trunc(requestedRankingLimit), 20), 500)
      : 200;

    const rowsPromise = env.MINUTE_DB.prepare(`SELECT row_json
      FROM sh_pages_track_history_read_model
      WHERE play_date>=? AND play_date<=?
      ORDER BY play_date ASC,first_played_at ASC,row_key ASC
      LIMIT ?`).bind(from, to, limit + 1).all();
    const statusPromise = includeRanking
      ? env.MINUTE_DB.prepare(`SELECT payload_json
          FROM sh_pages_payload_read_model
          WHERE model_key='track-history-status'
          LIMIT 1`).first()
      : Promise.resolve(null);
    const [result, status] = await Promise.all([rowsPromise, statusPromise]);

    const rawRows = result.results || [];
    const truncated = rawRows.length > limit;
    const rows = rawRows.slice(0, limit).map((row) => JSON.parse(row.row_json));
    const metadata = status?.payload_json ? JSON.parse(status.payload_json) : {};
    const fullRanking = includeRanking && Array.isArray(metadata.ranking) ? metadata.ranking : [];
    const ranking = fullRanking.slice(0, rankingLimit);
    const rankingSummary = includeRanking
      && metadata.ranking_summary && typeof metadata.ranking_summary === 'object'
      ? metadata.ranking_summary
      : {};

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
      ranking,
      ranking_limit: includeRanking ? rankingLimit : 0,
      ranking_truncated: includeRanking && fullRanking.length > ranking.length,
      ranking_summary: rankingSummary,
      ranking_scope: includeRanking ? 'all-time-latest-counter' : null,
      source_row_count: includeRanking ? metadata.source_row_count || 0 : null,
      excluded_play_count_dates: includeRanking ? metadata.excluded_play_count_dates || [] : [],
      excluded_play_count_date_count: includeRanking
        ? (metadata.excluded_play_count_dates || []).length
        : 0,
      generated_at: includeRanking ? metadata.generated_at || null : null,
      historical_recovery: 'worker_materialized_read_model',
      method: 'precomputed_track_history_read_model',
    });
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) {
      return json({
        ok: true,
        mode: 'tracks',
        rows: [],
        ranking: [],
        ranking_summary: {},
        setup_required: true,
        timezone: 'UTC',
      });
    }
    return json({ ok: false, error: error?.message || 'track history error' }, 500);
  }
}
