const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: JSON_HEADERS,
});

export async function onRequestGet({ env }) {
  if (!env?.OTHER_DB?.prepare) return json({ ok: false, error: 'OTHER_DB unavailable' }, 503);
  try {
    const run = await env.OTHER_DB.prepare(`SELECT test_id,target_handle,started_at,ends_at,status,updated_at
      FROM sh_sakurazaka46jp_collection_tests ORDER BY started_at DESC LIMIT 1`).first();
    if (!run) return json({ ok: true, test: null, samples: [], chats: [] });

    const [mainResult, chatResult] = await Promise.all([
      env.OTHER_DB.prepare(`SELECT observed_at,observed_minute,station_id,broadcast_id,broadcast_start_time,
          is_broadcasting,listener_count,guest_count,total_listens,status,chat_status,channel_id,channel_alias,
          json_valid(raw_json) AS raw_valid,length(raw_json) AS raw_bytes
        FROM sh_sakurazaka46jp_main
        WHERE observed_at>=? AND observed_at<?
        ORDER BY observed_at ASC,id ASC`).bind(run.started_at, run.ends_at).all(),
      env.OTHER_DB.prepare(`SELECT observed_at,observed_minute,station_id,
          json_valid(raw_json) AS raw_valid,length(raw_json) AS raw_bytes
        FROM sh_sakurazaka46jp_chat
        WHERE observed_at>=? AND observed_at<?
        ORDER BY observed_at ASC,id ASC`).bind(run.started_at, run.ends_at).all(),
    ]);

    const now = Date.now();
    const effectiveStatus = run.status === 'running' && now >= Number(run.ends_at)
      ? 'completed-awaiting-checkpoint'
      : run.status;
    return json({
      ok: true,
      test: {
        id: run.test_id,
        handle: run.target_handle,
        started_at: Number(run.started_at),
        ends_at: Number(run.ends_at),
        status: effectiveStatus,
        updated_at: Number(run.updated_at),
        duration_ms: Number(run.ends_at) - Number(run.started_at),
      },
      samples: mainResult.results || [],
      chats: chatResult.results || [],
      sample_count: (mainResult.results || []).length,
      chat_sample_count: (chatResult.results || []).length,
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes('no such table: sh_sakurazaka46jp_collection_tests')) {
      return json({ ok: true, test: null, samples: [], chats: [] });
    }
    return json({ ok: false, error: message.slice(0, 500) }, 500);
  }
}
