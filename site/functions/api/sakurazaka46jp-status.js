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
  return `SELECT observed_at,observed_minute,station_id,broadcast_id,broadcast_start_time,
      is_broadcasting,listener_count,guest_count,total_listens,status,chat_status,channel_id,channel_alias,
      json_valid(raw_json) AS raw_valid,length(raw_json) AS raw_bytes
    FROM sh_sakurazaka46jp_main
    ORDER BY observed_at DESC,id DESC
    LIMIT ${RECENT_LIMIT}`;
}

function recentChatSql() {
  return `SELECT observed_at,observed_minute,station_id,
      json_valid(raw_json) AS raw_valid,length(raw_json) AS raw_bytes
    FROM sh_sakurazaka46jp_chat
    ORDER BY observed_at DESC,id DESC
    LIMIT ${RECENT_LIMIT}`;
}

export async function onRequestGet({ env }) {
  if (!env?.OTHER_DB?.prepare) return json({ ok: false, error: 'OTHER_DB unavailable' }, 503);
  try {
    const [mainResult, chatResult] = await Promise.all([
      env.OTHER_DB.prepare(recentMainSql()).all(),
      env.OTHER_DB.prepare(recentChatSql()).all(),
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
