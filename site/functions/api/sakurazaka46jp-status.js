const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const ACTIVE_MAIN_LIMIT = 180;
const IDLE_LIMIT = 1;
const CHAT_LIMIT = 1;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: JSON_HEADERS,
});

function recentMainSql(limit) {
  return `SELECT m.observed_at,m.observed_minute,m.station_id,m.broadcast_id,m.broadcast_start_time,
      m.is_broadcasting,m.listener_count,m.guest_count,m.total_listens,m.status,m.chat_status,m.channel_id,m.channel_alias,
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
      ) AS INTEGER) END AS total_streams,
      json_valid(m.raw_json) AS raw_valid,length(m.raw_json) AS raw_bytes
    FROM sh_sakurazaka46jp_main AS m
    WHERE NOT EXISTS (
      SELECT 1 FROM sh_sakurazaka46jp_collection_tests AS t
      WHERE m.observed_at>=t.started_at AND m.observed_at<t.ends_at
    )
    ORDER BY m.observed_at DESC,m.id DESC
    LIMIT ${limit}`;
}

function recentChatSql(limit) {
  return `SELECT c.observed_at,c.observed_minute,c.station_id,
      json_valid(c.raw_json) AS raw_valid,length(c.raw_json) AS raw_bytes
    FROM sh_sakurazaka46jp_chat AS c
    WHERE NOT EXISTS (
      SELECT 1 FROM sh_sakurazaka46jp_collection_tests AS t
      WHERE c.observed_at>=t.started_at AND c.observed_at<t.ends_at
    )
    ORDER BY c.observed_at DESC,c.id DESC
    LIMIT ${limit}`;
}

function announcementSql() {
  return `SELECT id,event_name,scheduled_at,first_broadcast_at,last_broadcast_at,status
    FROM sh_official_news_announcements
    WHERE status='active'
       OR (status='scheduled' AND scheduled_at IS NOT NULL)
    ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,
      CASE WHEN status='active' THEN COALESCE(first_broadcast_at,scheduled_at) END DESC,
      CASE WHEN status='scheduled' THEN scheduled_at END ASC,
      id DESC
    LIMIT 1`;
}

function emptyPayload(generatedAt) {
  return {
    ok: true,
    handle: 'sakurazaka46jp',
    generated_at: generatedAt,
    collection_active: false,
    active_event: null,
    event: null,
    latest_main: null,
    latest_chat: null,
    latest: null,
    latest_main_age_ms: null,
    latest_chat_age_ms: null,
    latest_age_ms: null,
    samples: [],
    chats: [],
    sample_count: 0,
    chat_sample_count: 0,
    recent_limit: IDLE_LIMIT,
    chat_recent_limit: CHAT_LIMIT,
    refresh_hint_ms: 60000,
  };
}

export async function onRequestGet({ env }) {
  if (!env?.OTHER_DB?.prepare) return json({ ok: false, error: 'OTHER_DB unavailable' }, 503);
  const generatedAt = Date.now();
  try {
    const event = await env.OTHER_DB.prepare(announcementSql()).first();
    const activeAnnouncement = event?.status === 'active' ? event : null;
    const mainLimit = activeAnnouncement ? ACTIVE_MAIN_LIMIT : IDLE_LIMIT;
    const [mainResult, chatResult] = await Promise.all([
      env.OTHER_DB.prepare(recentMainSql(mainLimit)).all(),
      env.OTHER_DB.prepare(recentChatSql(CHAT_LIMIT)).all(),
    ]);
    const samples = mainResult.results || [];
    const chats = chatResult.results || [];
    const latestMain = samples[0] || null;
    const latestChat = chats[0] || null;
    const latestMainAgeMs = latestMain ? Math.max(0, generatedAt - Number(latestMain.observed_at)) : null;
    const latestChatAgeMs = latestChat ? Math.max(0, generatedAt - Number(latestChat.observed_at)) : null;
    return json({
      ok: true,
      handle: 'sakurazaka46jp',
      generated_at: generatedAt,
      collection_active: Boolean(activeAnnouncement),
      active_event: activeAnnouncement,
      event: event || null,
      latest_main: latestMain,
      latest_chat: latestChat,
      latest: latestMain,
      latest_main_age_ms: latestMainAgeMs,
      latest_chat_age_ms: latestChatAgeMs,
      latest_age_ms: latestMainAgeMs,
      samples,
      chats,
      sample_count: samples.length,
      chat_sample_count: chats.length,
      recent_limit: mainLimit,
      chat_recent_limit: CHAT_LIMIT,
      refresh_hint_ms: activeAnnouncement ? 15000 : 60000,
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/no such table: sh_sakurazaka46jp_(main|chat)/i.test(message)
        || /no such table: sh_official_news_announcements/i.test(message)) {
      return json(emptyPayload(generatedAt));
    }
    return json({ ok: false, error: message.slice(0, 500) }, 500);
  }
}
