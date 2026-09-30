const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, max-age=10, stale-while-revalidate=10',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: status === 200 ? JSON_HEADERS : { ...JSON_HEADERS, 'cache-control': 'no-store' },
});

function jstDayBounds(now = Date.now()) {
  const day = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
  const start = Date.parse(`${day}T00:00:00+09:00`);
  return { day, start, end: start + 86_400_000 };
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

async function loadEvent(env, start, end) {
  return env.OTHER_DB.prepare(`SELECT
      id,news_url,title,event_name,scheduled_at,first_broadcast_at,last_broadcast_at,status
    FROM sh_nogizaka_official_news_announcements
    WHERE (scheduled_at>=?1 AND scheduled_at<?2)
       OR (first_broadcast_at>=?1 AND first_broadcast_at<?2)
       OR (last_broadcast_at>=?1 AND last_broadcast_at<?2)
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'ended' THEN 2 ELSE 3 END,
      COALESCE(first_broadcast_at,scheduled_at,last_broadcast_at) DESC,id DESC
    LIMIT 1`).bind(start, end).first();
}

async function loadProbes(env, announcementId) {
  const result = await env.OTHER_DB.prepare(`SELECT
      observed_at,broadcast_id,broadcast_start_time,is_broadcasting,listener_count,total_listens
    FROM sh_nogizaka_official_news_station_probes
    WHERE announcement_id=?
    ORDER BY observed_at ASC,id ASC
    LIMIT 720`).bind(announcementId).all();
  return result.results || [];
}

async function loadSummary(env, event) {
  if (!event?.event_name) return null;
  return env.OTHER_DB.prepare(`SELECT
      event_name,started_at,ended_at,sample_count,listener_avg,listener_min,listener_max,
      likes_max,distinct_tracks,host_handle
    FROM sh_official_broadcast_summary
    WHERE host_handle='nogizaka46smej' AND event_name=?
    ORDER BY started_at DESC LIMIT 1`).bind(event.event_name).first();
}

function buildPayload(event, probes, summary, generatedAt, day) {
  const preferredBroadcastId = probes.slice().reverse().find((row) =>
    Number(row?.is_broadcasting) === 1 && finite(row?.broadcast_id) != null)?.broadcast_id;
  const start = finite(event?.first_broadcast_at)
    ?? finite(probes.find((row) => finite(row?.broadcast_start_time) != null)?.broadcast_start_time)
    ?? finite(event?.scheduled_at)
    ?? finite(summary?.started_at);
  const points = [];
  const listeners = [];
  for (const row of probes) {
    if (preferredBroadcastId != null && (
      Number(row?.is_broadcasting) !== 1
      || Number(row?.broadcast_id) !== Number(preferredBroadcastId)
    )) continue;
    const observedAt = finite(row?.observed_at);
    const listener = finite(row?.listener_count);
    if (observedAt == null || listener == null || start == null || observedAt < start) continue;
    const minute = Math.max(0, Math.floor((observedAt - start) / 60_000));
    points.push([minute, listener]);
    listeners.push(listener);
  }
  const latestObservedAt = finite(probes.at(-1)?.observed_at);
  const live = event?.status === 'active';
  const endedAt = live ? null : (finite(event?.last_broadcast_at) ?? finite(summary?.ended_at) ?? latestObservedAt);
  const listenerAvg = finite(summary?.listener_avg) ?? average(listeners);
  const listenerMin = finite(summary?.listener_min) ?? (listeners.length ? Math.min(...listeners) : null);
  const listenerMax = finite(summary?.listener_max) ?? (listeners.length ? Math.max(...listeners) : null);
  const distinctTracks = finite(summary?.distinct_tracks);
  const estimatedStreams = listenerAvg != null && distinctTracks != null
    ? Math.round(listenerAvg * distinctTracks)
    : null;
  const row = event ? {
    event_name: event.event_name || event.title || '乃木坂46 公式リスパ',
    started_at: start,
    ended_at: endedAt,
    sample_count: finite(summary?.sample_count) ?? listeners.length,
    listener_avg: listenerAvg,
    listener_min: listenerMin,
    listener_max: listenerMax,
    likes_max: finite(summary?.likes_max),
    distinct_tracks: distinctTracks,
    estimated_streams: estimatedStreams,
    host_handle: 'nogizaka46smej',
    broadcast_content: '42nd アンダーライブ セットリスト',
    source_url: event.news_url || null,
    status: event.status || null,
  } : null;
  return {
    ok: true,
    handle: 'nogizaka46smej',
    date: day,
    generated_at: generatedAt,
    collection_active: live,
    refresh_hint_ms: live ? 15_000 : 60_000,
    event: event || null,
    row,
    series: row ? [{
      event_name: `${day.replaceAll('-', '/')} ${row.broadcast_content}`,
      started_at: row.started_at,
      points,
      source: live ? 'official_news_live' : (summary ? 'official_broadcast_summary' : 'official_news_probes'),
    }] : [],
  };
}

export async function onRequestGet({ env }) {
  if (!env?.OTHER_DB?.prepare) return json({ ok: false, error: 'OTHER_DB unavailable' }, 503);
  const generatedAt = Date.now();
  const { day, start, end } = jstDayBounds(generatedAt);
  try {
    const event = await loadEvent(env, start, end);
    if (!event) {
      return json({
        ok: true,
        handle: 'nogizaka46smej',
        date: day,
        generated_at: generatedAt,
        collection_active: false,
        refresh_hint_ms: 60_000,
        event: null,
        row: null,
        series: [],
      });
    }
    const [probes, summary] = await Promise.all([
      loadProbes(env, event.id),
      loadSummary(env, event).catch(() => null),
    ]);
    return json(buildPayload(event, probes, summary, generatedAt, day));
  } catch (error) {
    const message = String(error?.message || error);
    if (/no such table|no such column/i.test(message)) {
      return json({ ok: true, handle: 'nogizaka46smej', date: day, generated_at: generatedAt,
        collection_active: false, refresh_hint_ms: 60_000, event: null, row: null, series: [] });
    }
    return json({ ok: false, error: message.slice(0, 500) }, 500);
  }
}
