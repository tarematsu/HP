const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, max-age=10, stale-while-revalidate=10',
};

const ACTIVE_MAIN_LIMIT = 180;
const IDLE_MAIN_LIMIT = 1;
const DEFAULT_LATE_WINDOW_MS = 90 * 60_000;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: JSON_HEADERS,
});

function announcementSql() {
  return `SELECT id,event_name,scheduled_at,first_broadcast_at,last_broadcast_at,status
    FROM sh_nogizaka_official_news_announcements
    WHERE status='active'
       OR (status='scheduled' AND scheduled_at>=?)
    ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,
      CASE WHEN status='active' THEN COALESCE(first_broadcast_at,scheduled_at) END DESC,
      CASE WHEN status='scheduled' THEN scheduled_at END ASC,
      id DESC
    LIMIT 1`;
}

function recentMainSql(limit) {
  return `SELECT m.observed_at,m.observed_minute,m.station_id,m.broadcast_id,m.broadcast_start_time,
      m.is_broadcasting,m.listener_count,m.guest_count,m.total_listens,m.status,m.chat_status,
      m.channel_id,m.channel_alias,
      CASE WHEN json_valid(m.raw_json) THEN CAST(COALESCE(
        json_extract(m.raw_json,'$.owner.followers'),
        json_extract(m.raw_json,'$.account.followers'),
        json_extract(m.raw_json,'$.broadcast.broadcasters[0].account.followers')
      ) AS INTEGER) END AS followers,
      CASE WHEN json_valid(m.raw_json) THEN CAST(COALESCE(
        json_extract(m.raw_json,'$.owner.following'),
        json_extract(m.raw_json,'$.account.following'),
        json_extract(m.raw_json,'$.broadcast.broadcasters[0].account.following')
      ) AS INTEGER) END AS following,
      CASE WHEN json_valid(m.raw_json) THEN CAST(COALESCE(
        json_extract(m.raw_json,'$.owner.total_streams'),
        json_extract(m.raw_json,'$.account.total_streams'),
        json_extract(m.raw_json,'$.broadcast.broadcasters[0].account.total_streams')
      ) AS INTEGER) END AS total_streams
    FROM sh_nogizaka46smej_main AS m
    ORDER BY m.observed_at DESC,m.id DESC
    LIMIT ${limit}`;
}

function emptyPayload(generatedAt) {
  return {
    ok: true,
    handle: 'nogizaka46smej',
    generated_at: generatedAt,
    collection_active: false,
    event: null,
    latest: null,
    latest_age_ms: null,
    samples: [],
    sample_count: 0,
    refresh_hint_ms: 60000,
  };
}

export async function onRequestGet({ env }) {
  if (!env?.OTHER_DB?.prepare) return json({ ok: false, error: 'OTHER_DB unavailable' }, 503);
  const generatedAt = Date.now();
  try {
    const configuredWindow = Math.trunc(Number(env.OFFICIAL_NEWS_LATE_WINDOW_MS));
    const lateWindowMs = Number.isFinite(configuredWindow) && configuredWindow > 0
      ? configuredWindow : DEFAULT_LATE_WINDOW_MS;
    const event = await env.OTHER_DB.prepare(announcementSql())
      .bind(generatedAt - lateWindowMs).first();
    const collectionActive = event?.status === 'active';
    const mainLimit = collectionActive ? ACTIVE_MAIN_LIMIT : IDLE_MAIN_LIMIT;
    const mainResult = await env.OTHER_DB.prepare(recentMainSql(mainLimit)).all();
    const samples = mainResult.results || [];
    const latest = samples[0] || null;
    return json({
      ok: true,
      handle: 'nogizaka46smej',
      generated_at: generatedAt,
      collection_active: collectionActive,
      event: event || null,
      latest,
      latest_age_ms: latest ? Math.max(0, generatedAt - Number(latest.observed_at)) : null,
      samples,
      sample_count: samples.length,
      refresh_hint_ms: collectionActive ? 15000 : 60000,
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/no such table: sh_nogizaka_(official_news_announcements|46smej_main)/i.test(message)
        || /no such table: sh_nogizaka46smej_main/i.test(message)) {
      return json(emptyPayload(generatedAt));
    }
    return json({ ok: false, error: message.slice(0, 500) }, 500);
  }
}
