const START = 1789958700000;
const END = 1789960620000;
const MINUTE = 60_000;

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function onRequestGet({ env }) {
  if (!env?.OTHER_DB?.prepare) return json({ ok: false, error: 'OTHER_DB unavailable' }, 503);
  try {
    const session = await env.OTHER_DB.prepare(`SELECT id,started_at,ended_at,comment_count
      FROM sh_host_broadcast_sessions
      WHERE source_scope='sakurazaka46jp_solo'
        AND lower(handle)='sakurazaka46jp'
        AND started_at>=1789957800000
        AND started_at<1789960620000
      ORDER BY started_at DESC,id DESC LIMIT 1`).first();
    if (!session) return json({ ok: false, error: 'target session not found' }, 404);
    const result = await env.OTHER_DB.prepare(`SELECT bucket_start,item_count
      FROM sh_solo_activity_minutes
      WHERE session_id=? AND bucket_start>=? AND bucket_start<?
      ORDER BY bucket_start ASC`).bind(session.id, START, END).all();
    const byMinute = new Map((result.results || []).map((row) => [Number(row.bucket_start), Number(row.item_count) || 0]));
    const minutes = [];
    let total = 0;
    for (let ts = START; ts < END; ts += MINUTE) {
      const count = byMinute.get(ts) || 0;
      total += count;
      minutes.push({ bucket_start: ts, elapsed_minute: (ts - START) / MINUTE, comment_count: count });
    }
    return json({ ok: true, start: START, end_exclusive: END, session, total, minutes });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error).slice(0, 1000) }, 500);
  }
}
