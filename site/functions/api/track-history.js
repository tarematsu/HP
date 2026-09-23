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

function rankingLimit(url) {
  const requested = Number(url.searchParams.get('ranking_limit'));
  return Number.isFinite(requested) && requested > 0
    ? Math.min(Math.max(Math.trunc(requested), 20), 500)
    : 200;
}

async function loadTrackHistoryStatus(db) {
  const row = await db.prepare(`SELECT payload_json
    FROM sh_pages_payload_read_model
    WHERE model_key='track-history-status'
    LIMIT 1`).first();
  if (!row?.payload_json) return {};
  try {
    const parsed = JSON.parse(row.payload_json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function loadTrackHistoryDates(db) {
  try {
    const result = await db.prepare(`SELECT play_date
      FROM sh_pages_track_history_daily_read_model
      WHERE row_count>0
      ORDER BY play_date ASC`).all();
    return (result.results || []).map((row) => String(row.play_date || '')).filter(validDate);
  } catch (error) {
    if (!/no such table/i.test(String(error?.message || ''))) throw error;
    const result = await db.prepare(`SELECT DISTINCT play_date
      FROM sh_pages_track_history_read_model
      ORDER BY play_date ASC`).all();
    return (result.results || []).map((row) => String(row.play_date || '')).filter(validDate);
  }
}

function rankingFromStatus(metadata, limit) {
  const fullRanking = Array.isArray(metadata?.ranking) ? metadata.ranking : [];
  const rows = fullRanking.slice(0, limit);
  const summary = metadata?.ranking_summary && typeof metadata.ranking_summary === 'object'
    ? metadata.ranking_summary
    : {};
  const total = Number(summary?.track_count);
  return {
    rows,
    fullRanking,
    summary,
    truncated: Number.isFinite(total) ? total > rows.length : fullRanking.length > rows.length,
  };
}

export async function onRequestGet({ request, env }) {
  if (!env?.MINUTE_DB) return json({ ok: false, error: 'MINUTE_DB binding missing' }, 500);
  const url = new URL(request.url);

  try {
    if (url.searchParams.get('ranking_only') === '1') {
      const metadata = await loadTrackHistoryStatus(env.MINUTE_DB);
      const ranking = rankingFromStatus(metadata, rankingLimit(url));
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
        ranking_scope: metadata.ranking_scope || 'all-time-latest-counter',
        generated_at: metadata.generated_at || ranking.summary.latest_observed_at || null,
        method: 'current_track_like_ranking',
        read_path: 'track-history-status-read-model',
      });
    }

    if (url.searchParams.get('dates_only') === '1') {
      const dates = await loadTrackHistoryDates(env.MINUTE_DB);
      return json({
        ok: true,
        mode: 'dates',
        timezone: 'UTC',
        dates,
        latest_date: dates.at(-1) || null,
        read_path: 'track-history-daily-read-model',
      });
    }

    if (url.searchParams.get('latest') === '1') {
      const metadata = await loadTrackHistoryStatus(env.MINUTE_DB);
      return json({ ok: true, latest_date: metadata.to || null, timezone: 'UTC' });
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
    const boundedRankingLimit = rankingLimit(url);

    const rowsPromise = env.MINUTE_DB.prepare(`SELECT row_json
      FROM sh_pages_track_history_read_model
      WHERE play_date>=? AND play_date<=?
      ORDER BY play_date ASC,first_played_at ASC,row_key ASC
      LIMIT ?`).bind(from, to, limit + 1).all();
    const statusPromise = includeRanking
      ? loadTrackHistoryStatus(env.MINUTE_DB)
      : Promise.resolve({});
    const [result, metadata] = await Promise.all([rowsPromise, statusPromise]);

    const rawRows = result.results || [];
    const truncated = rawRows.length > limit;
    const rows = rawRows.slice(0, limit).map((row) => JSON.parse(row.row_json));
    const rankingData = includeRanking
      ? rankingFromStatus(metadata, boundedRankingLimit)
      : { rows: [], fullRanking: [], summary: {}, truncated: false };

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
      ranking: rankingData.rows,
      ranking_limit: includeRanking ? boundedRankingLimit : 0,
      ranking_truncated: includeRanking && rankingData.truncated,
      ranking_summary: rankingData.summary,
      ranking_scope: includeRanking ? metadata.ranking_scope || 'all-time-latest-counter' : null,
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
        mode: url.searchParams.get('ranking_only') === '1' ? 'likes' : 'tracks',
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
