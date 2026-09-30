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

export function formatNogizakaBroadcastContent(event) {
  const raw = String(event?.event_name || event?.title || '')
    .replace(/[「」]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const underLive = raw.match(/(\d+(?:st|nd|rd|th))(?:SG)?\s*アンダーライブ/iu);
  if (underLive) return `${underLive[1]} アンダーライブ セットリスト`;
  const cleaned = raw
    .replace(/\s*Stationhead\s*(?:リスニングパーティー|Listening Party)?.*$/iu, '')
    .replace(/\s*リスニングパーティー.*$/u, '')
    .replace(/\s*開催決定[！!。]?\s*$/u, '')
    .trim();
  return cleaned || '乃木坂46 公式リスパ';
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

async function loadSummary(env, event) {
  if (!event?.event_name) return null;
  return env.OTHER_DB.prepare(`SELECT
      event_name,started_at,ended_at,sample_count,listener_avg,listener_min,listener_max,
      likes_max,distinct_tracks,host_handle,refreshed_at
    FROM sh_official_broadcast_summary
    WHERE host_handle='nogizaka46smej' AND event_name=?
    ORDER BY started_at DESC LIMIT 1`).bind(event.event_name).first();
}

async function loadSeries(env, event) {
  if (!event?.event_name) return null;
  return env.OTHER_DB.prepare(`SELECT
      event_name,started_at,points_json,source_ref,refreshed_at
    FROM sh_official_broadcast_series
    WHERE host_handle='nogizaka46smej' AND event_name=?
    LIMIT 1`).bind(event.event_name).first();
}

async function loadLiveProbes(env, announcementId, observedAfter) {
  const result = await env.OTHER_DB.prepare(`SELECT
      observed_at,broadcast_id,broadcast_start_time,listener_count
    FROM sh_nogizaka_official_news_station_probes
    WHERE announcement_id=? AND is_broadcasting=1 AND listener_count IS NOT NULL
      AND observed_at>=?
    ORDER BY observed_at ASC,id ASC
    LIMIT 180`).bind(announcementId, Math.max(0, Number(observedAfter) || 0)).all();
  return result.results || [];
}

function materializedPoints(series) {
  if (!series?.points_json) return [];
  try {
    const parsed = JSON.parse(series.points_json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((point) => {
        const minute = finite(point?.[0]);
        const listener = finite(point?.[1]);
        const samples = Math.max(1, Math.trunc(finite(point?.[2]) ?? 1));
        return minute == null || listener == null ? null : [minute, listener, samples];
      })
      .filter(Boolean)
      .sort((left, right) => left[0] - right[0]);
  } catch {
    return [];
  }
}

function liveProbePoints(probes, start) {
  if (start == null) return [];
  const preferredBroadcastId = probes.slice().reverse().find((row) =>
    finite(row?.broadcast_id) != null)?.broadcast_id;
  const byMinute = new Map();
  for (const row of probes) {
    if (preferredBroadcastId != null
        && Number(row?.broadcast_id) !== Number(preferredBroadcastId)) continue;
    const observedAt = finite(row?.observed_at);
    const listener = finite(row?.listener_count);
    if (observedAt == null || listener == null || observedAt < start) continue;
    const minute = Math.max(0, Math.floor((observedAt - start) / 60_000));
    byMinute.set(minute, [minute, listener, 1]);
  }
  return [...byMinute.values()].sort((left, right) => left[0] - right[0]);
}

function mergePoints(basePoints, livePoints) {
  const byMinute = new Map(basePoints.map((point) => [point[0], point]));
  for (const point of livePoints) byMinute.set(point[0], point);
  return [...byMinute.values()].sort((left, right) => left[0] - right[0]);
}

function pointStats(points) {
  let sampleCount = 0;
  let weightedTotal = 0;
  let listenerMin = null;
  let listenerMax = null;
  for (const point of points) {
    const listener = finite(point?.[1]);
    const samples = Math.max(1, Math.trunc(finite(point?.[2]) ?? 1));
    if (listener == null) continue;
    sampleCount += samples;
    weightedTotal += listener * samples;
    listenerMin = listenerMin == null ? listener : Math.min(listenerMin, listener);
    listenerMax = listenerMax == null ? listener : Math.max(listenerMax, listener);
  }
  return {
    sampleCount,
    listenerAvg: sampleCount ? weightedTotal / sampleCount : null,
    listenerMin,
    listenerMax,
  };
}

function combinedStats(summary, basePoints, livePoints) {
  const baseDerived = pointStats(basePoints);
  const baseCount = finite(summary?.sample_count) ?? baseDerived.sampleCount;
  const baseAverage = finite(summary?.listener_avg) ?? baseDerived.listenerAvg;
  const baseMinimum = finite(summary?.listener_min) ?? baseDerived.listenerMin;
  const baseMaximum = finite(summary?.listener_max) ?? baseDerived.listenerMax;
  const lastBaseMinute = basePoints.length ? finite(basePoints.at(-1)?.[0]) : null;
  const additions = lastBaseMinute == null
    ? livePoints
    : livePoints.filter((point) => finite(point?.[0]) > lastBaseMinute);
  const tail = pointStats(additions);
  const sampleCount = Math.max(0, Math.trunc(baseCount || 0)) + tail.sampleCount;
  const listenerAvg = sampleCount
    ? (((baseAverage ?? 0) * Math.max(0, Math.trunc(baseCount || 0)))
      + ((tail.listenerAvg ?? 0) * tail.sampleCount)) / sampleCount
    : null;
  const minimums = [baseMinimum, tail.listenerMin].filter((value) => value != null);
  const maximums = [baseMaximum, tail.listenerMax].filter((value) => value != null);
  return {
    sampleCount,
    listenerAvg,
    listenerMin: minimums.length ? Math.min(...minimums) : null,
    listenerMax: maximums.length ? Math.max(...maximums) : null,
  };
}

function buildPayload(event, summary, readSeries, probes, generatedAt, day) {
  const live = event?.status === 'active';
  const basePoints = materializedPoints(readSeries);
  const start = finite(readSeries?.started_at)
    ?? finite(summary?.started_at)
    ?? finite(event?.first_broadcast_at)
    ?? finite(probes.find((row) => finite(row?.broadcast_start_time) != null)?.broadcast_start_time)
    ?? finite(event?.scheduled_at);
  const realtimePoints = live ? liveProbePoints(probes, start) : [];
  const points = live ? mergePoints(basePoints, realtimePoints) : basePoints;
  const stats = combinedStats(summary, basePoints, realtimePoints);
  const endedAt = live ? null : (finite(summary?.ended_at) ?? finite(event?.last_broadcast_at));
  const distinctTracks = finite(summary?.distinct_tracks);
  const estimatedStreams = stats.listenerAvg != null && distinctTracks != null
    ? Math.round(stats.listenerAvg * distinctTracks)
    : null;
  const finalized = event?.status !== 'ended' || Boolean(summary && readSeries);
  const row = event ? {
    event_name: event.event_name || event.title || '乃木坂46 公式リスパ',
    started_at: start,
    ended_at: endedAt,
    sample_count: stats.sampleCount,
    listener_avg: stats.listenerAvg,
    listener_min: stats.listenerMin,
    listener_max: stats.listenerMax,
    likes_max: finite(summary?.likes_max),
    distinct_tracks: distinctTracks,
    estimated_streams: estimatedStreams,
    host_handle: 'nogizaka46smej',
    broadcast_content: formatNogizakaBroadcastContent(event),
    source_url: event.news_url || null,
    status: event.status || null,
  } : null;
  let source = 'official_read_model_pending';
  if (live) {
    if (basePoints.length && realtimePoints.length) source = 'official_broadcast_series+official_news_live';
    else if (basePoints.length) source = 'official_broadcast_series';
    else source = 'official_news_live';
  } else if (readSeries) source = 'official_broadcast_series';
  else if (summary) source = 'official_broadcast_summary';
  return {
    ok: true,
    handle: 'nogizaka46smej',
    date: day,
    generated_at: generatedAt,
    collection_active: live,
    refresh_hint_ms: live || !finalized ? 15_000 : 60_000,
    event: event || null,
    row,
    series: row ? [{
      event_name: `${day.replaceAll('-', '')} ${row.broadcast_content}`,
      started_at: row.started_at,
      points,
      source,
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
    const [summary, readSeries] = await Promise.all([
      loadSummary(env, event).catch(() => null),
      loadSeries(env, event).catch(() => null),
    ]);
    let probes = [];
    if (event.status === 'active') {
      const basePoints = materializedPoints(readSeries);
      const readStart = finite(readSeries?.started_at)
        ?? finite(summary?.started_at)
        ?? finite(event.first_broadcast_at)
        ?? finite(event.scheduled_at)
        ?? 0;
      const lastMinute = basePoints.length ? finite(basePoints.at(-1)?.[0]) : null;
      const observedAfter = lastMinute == null
        ? (finite(summary?.refreshed_at) ?? readStart)
        : readStart + Math.max(0, lastMinute) * 60_000;
      probes = await loadLiveProbes(env, event.id, observedAfter);
    }
    return json(buildPayload(event, summary, readSeries, probes, generatedAt, day));
  } catch (error) {
    const message = String(error?.message || error);
    if (/no such table|no such column/i.test(message)) {
      return json({ ok: true, handle: 'nogizaka46smej', date: day, generated_at: generatedAt,
        collection_active: false, refresh_hint_ms: 60_000, event: null, row: null, series: [] });
    }
    return json({ ok: false, error: message.slice(0, 500) }, 500);
  }
}
