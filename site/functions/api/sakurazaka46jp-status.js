const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const RECENT_LIMIT = 180;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: JSON_HEADERS,
});

function recentMainSql() {
  return `SELECT m.observed_at,m.observed_minute,m.station_id,m.broadcast_id,m.broadcast_start_time,
      m.is_broadcasting,m.listener_count,m.guest_count,m.total_listens,m.status,m.chat_status,m.channel_id,m.channel_alias,
      json_valid(m.raw_json) AS raw_valid,length(m.raw_json) AS raw_bytes
    FROM sh_sakurazaka46jp_main AS m
    WHERE NOT EXISTS (
      SELECT 1 FROM sh_sakurazaka46jp_collection_tests AS t
      WHERE m.observed_at>=t.started_at AND m.observed_at<t.ends_at
    )
    ORDER BY m.observed_at DESC,m.id DESC
    LIMIT ${RECENT_LIMIT}`;
}

function recentChatSql() {
  return `SELECT c.observed_at,c.observed_minute,c.station_id,
      json_valid(c.raw_json) AS raw_valid,length(c.raw_json) AS raw_bytes
    FROM sh_sakurazaka46jp_chat AS c
    WHERE NOT EXISTS (
      SELECT 1 FROM sh_sakurazaka46jp_collection_tests AS t
      WHERE c.observed_at>=t.started_at AND c.observed_at<t.ends_at
    )
    ORDER BY c.observed_at DESC,c.id DESC
    LIMIT ${RECENT_LIMIT}`;
}

function activeAnnouncementSql() {
  return `SELECT id,event_name,scheduled_at,first_broadcast_at,last_broadcast_at,status
    FROM sh_official_news_announcements
    WHERE status='active'
    ORDER BY COALESCE(first_broadcast_at,scheduled_at) DESC,id DESC
    LIMIT 1`;
}

export async function onRequestGet({ env }) {
  if (!env?.OTHER_DB?.prepare) return json({ ok: false, error: 'OTHER_DB unavailable' }, 503);
  try {
    const [mainResult, chatResult, activeAnnouncement] = await Promise.all([
      env.OTHER_DB.prepare(recentMainSql()).all(),
      env.OTHER_DB.prepare(recentChatSql()).all(),
      env.OTHER_DB.prepare(activeAnnouncementSql()).first(),
    ]);
    const samples = mainResult.results || [];
    const chats = chatResult.results || [];
    const generatedAt = Date.now();
    const latestMain = samples[0] || null;
    const latestChat = chats[0] || null;
    return json({
      ok: true,
      handle: 'sakurazaka46jp',
      generated_at: generatedAt,
      collection_active: Boolean(activeAnnouncement),
      active_event: activeAnnouncement || null,
      latest_main: latestMain,
      latest_chat: latestChat,
      latest_main_age_ms: latestMain ? Math.max(0, generatedAt - Number(latestMain.observed_at)) : null,
      latest_chat_age_ms: latestChat ? Math.max(0, generatedAt - Number(latestChat.observed_at)) : null,
      samples,
      chats,
      sample_count: samples.length,
      chat_sample_count: chats.length,
      recent_limit: RECENT_LIMIT,
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/no such table: sh_sakurazaka46jp_(main|chat)/i.test(message)) {
      return json({
        ok: true,
        handle: 'sakurazaka46jp',
        generated_at: Date.now(),
        collection_active: false,
        active_event: null,
        latest_main: null,
        latest_chat: null,
        latest_main_age_ms: null,
        latest_chat_age_ms: null,
        samples: [],
        chats: [],
        sample_count: 0,
        chat_sample_count: 0,
        recent_limit: RECENT_LIMIT,
      });
    }
    return json({ ok: false, error: message.slice(0, 500) }, 500);
  }
}
