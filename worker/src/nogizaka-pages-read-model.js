import { formatNogizakaBroadcastContent } from '../../site/functions/api/nogizaka-listening-party.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

export const NOGIZAKA_LISTENING_PARTY_MODEL_KEY = 'nogizaka-listening-party';
export const NOGIZAKA_LISTENING_PARTY_CADENCE_SECONDS = 60;
const HISTORY_LIMIT = 100;

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=15, s-maxage=60, stale-while-revalidate=120',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jstDayBounds(now = Date.now()) {
  const day = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
  const start = Date.parse(`${day}T00:00:00+09:00`);
  return { day, start, end: start + 86_400_000 };
}

function jstDayKey(value, fallbackDay) {
  const timestamp = finite(value);
  if (timestamp == null) return fallbackDay.replaceAll('-', '');
  return new Date(timestamp + 9 * 3_600_000).toISOString().slice(0, 10).replaceAll('-', '');
}

async function loadEvent(db, start, end) {
  return db.prepare(`SELECT
      id,news_url,title,event_name,scheduled_at,first_broadcast_at,last_broadcast_at,status
    FROM sh_nogizaka_official_news_announcements
    WHERE status<>'invalid' AND (
      (scheduled_at>=?1 AND scheduled_at<?2)
       OR (first_broadcast_at>=?1 AND first_broadcast_at<?2)
       OR (last_broadcast_at>=?1 AND last_broadcast_at<?2)
    )
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'ended' THEN 2 ELSE 3 END,
      COALESCE(first_broadcast_at,scheduled_at,last_broadcast_at) DESC,id DESC
    LIMIT 1`).bind(start, end).first();
}

async function loadHistory(db) {
  const result = await db.prepare(`WITH latest_sources AS (
      SELECT event_name,MAX(id) AS id
      FROM sh_nogizaka_official_news_announcements
      WHERE status<>'invalid'
      GROUP BY event_name
    )
    SELECT
      s.event_name,s.started_at,s.ended_at,s.sample_count,s.listener_avg,s.listener_min,s.listener_max,
      s.likes_max,s.distinct_tracks,s.host_handle,s.refreshed_at,
      a.news_url AS source_url,a.title AS source_title
    FROM sh_official_broadcast_summary AS s
    LEFT JOIN latest_sources AS latest ON latest.event_name=s.event_name
    LEFT JOIN sh_nogizaka_official_news_announcements AS a ON a.id=latest.id
    WHERE s.host_handle='nogizaka46smej'
    ORDER BY s.started_at DESC
    LIMIT ?`).bind(HISTORY_LIMIT).all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function loadSummary(db, event) {
  if (!event?.event_name) return null;
  return db.prepare(`SELECT
      event_name,started_at,ended_at,sample_count,listener_avg,listener_min,listener_max,
      likes_max,distinct_tracks,host_handle,refreshed_at
    FROM sh_official_broadcast_summary
    WHERE host_handle='nogizaka46smej' AND event_name=?
    ORDER BY started_at DESC LIMIT 1`).bind(event.event_name).first();
}

async function loadSeries(db, event) {
  if (!event?.event_name) return null;
  return db.prepare(`SELECT
      event_name,started_at,points_json,source_ref,refreshed_at
    FROM sh_official_broadcast_series
    WHERE host_handle='nogizaka46smej' AND event_name=?
    LIMIT 1`).bind(event.event_name).first();
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

function summaryRow(summary) {
  if (!summary?.event_name) return null;
  const listenerAvg = finite(summary.listener_avg);
  const distinctTracks = finite(summary.distinct_tracks);
  return {
    event_name: String(summary.event_name),
    started_at: finite(summary.started_at),
    ended_at: finite(summary.ended_at),
    sample_count: finite(summary.sample_count),
    listener_avg: listenerAvg,
    listener_min: finite(summary.listener_min),
    listener_max: finite(summary.listener_max),
    likes_max: finite(summary.likes_max),
    distinct_tracks: distinctTracks,
    estimated_streams: listenerAvg != null && distinctTracks != null
      ? Math.round(listenerAvg * distinctTracks)
      : null,
    host_handle: 'nogizaka46smej',
    broadcast_content: formatNogizakaBroadcastContent({
      event_name: summary.event_name,
      title: summary.source_title,
    }),
    source_url: summary.source_url || null,
    status: 'ended',
  };
}

function mergeRows(currentRow, history) {
  const rows = history.map(summaryRow).filter(Boolean);
  if (currentRow) {
    const index = rows.findIndex((row) => row.event_name === currentRow.event_name);
    if (index >= 0) rows[index] = { ...rows[index], ...currentRow };
    else rows.unshift(currentRow);
  }
  return rows.sort((left, right) => (finite(right.started_at) ?? 0) - (finite(left.started_at) ?? 0));
}

function buildPayload(event, summary, readSeries, history, generatedAt, day) {
  const live = event?.status === 'active';
  const points = materializedPoints(readSeries);
  const derived = pointStats(points);
  let row = null;

  if (event || summary) {
    const start = finite(readSeries?.started_at)
      ?? finite(summary?.started_at)
      ?? finite(event?.first_broadcast_at)
      ?? finite(event?.scheduled_at);
    const sampleCount = finite(summary?.sample_count) ?? derived.sampleCount;
    const listenerAvg = finite(summary?.listener_avg) ?? derived.listenerAvg;
    const listenerMin = finite(summary?.listener_min) ?? derived.listenerMin;
    const listenerMax = finite(summary?.listener_max) ?? derived.listenerMax;
    const distinctTracks = finite(summary?.distinct_tracks);
    const estimatedStreams = listenerAvg != null && distinctTracks != null
      ? Math.round(listenerAvg * distinctTracks)
      : null;
    const rowEvent = event || { event_name: summary?.event_name, title: summary?.source_title };
    row = {
      event_name: rowEvent.event_name || rowEvent.title || '乃木坂46 公式リスパ',
      started_at: start,
      ended_at: live ? null : (finite(summary?.ended_at) ?? finite(event?.last_broadcast_at)),
      sample_count: sampleCount,
      listener_avg: listenerAvg,
      listener_min: listenerMin,
      listener_max: listenerMax,
      likes_max: finite(summary?.likes_max),
      distinct_tracks: distinctTracks,
      estimated_streams: estimatedStreams,
      host_handle: 'nogizaka46smej',
      broadcast_content: formatNogizakaBroadcastContent(rowEvent),
      source_url: event?.news_url || summary?.source_url || null,
      status: event?.status || 'ended',
    };
  }

  const rows = mergeRows(row, history);
  const source = readSeries
    ? 'official_broadcast_series'
    : summary ? 'official_broadcast_summary' : 'official_read_model_pending';
  const series = row ? [{
    event_name: `${jstDayKey(row.started_at, day)} ${row.broadcast_content}`,
    started_at: row.started_at,
    points,
    source,
  }] : [];

  return {
    ok: true,
    handle: 'nogizaka46smej',
    date: day,
    generated_at: generatedAt,
    collection_active: live,
    refresh_hint_ms: NOGIZAKA_LISTENING_PARTY_CADENCE_SECONDS * 1000,
    event: event || null,
    row,
    rows,
    series,
  };
}

export async function buildNogizakaListeningPartyReadModel(env, now = Date.now()) {
  const db = env?.OTHER_DB;
  if (!db?.prepare) throw new Error('OTHER_DB binding is missing');
  const generatedAt = Number(now) || Date.now();
  const { day, start, end } = jstDayBounds(generatedAt);
  const [event, history] = await Promise.all([
    loadEvent(db, start, end),
    loadHistory(db),
  ]);
  const fallbackSummary = history[0] || null;
  const focus = event || (fallbackSummary ? { event_name: fallbackSummary.event_name } : null);
  const [summary, readSeries] = await Promise.all([
    event ? loadSummary(db, event).catch(() => null) : Promise.resolve(fallbackSummary),
    focus ? loadSeries(db, focus).catch(() => null) : Promise.resolve(null),
  ]);
  return buildPayload(event, summary, readSeries, history, generatedAt, day);
}

export async function publishNogizakaListeningPartyReadModel(env, now = Date.now()) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.put !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is missing');
  const updatedAt = Number(now) || Date.now();
  const payload = await buildNogizakaListeningPartyReadModel(env, updatedAt);
  const key = pagesActionsR2ResponseKey(NOGIZAKA_LISTENING_PARTY_MODEL_KEY);
  if (!key) throw new Error('Nogizaka listening-party Pages read-model key is invalid');
  const envelope = {
    version: 1,
    updated_at: updatedAt,
    cadence_seconds: NOGIZAKA_LISTENING_PARTY_CADENCE_SECONDS,
    status: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  };
  await r2.put(key, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      version: '1',
      model_key: NOGIZAKA_LISTENING_PARTY_MODEL_KEY,
      updated_at: String(updatedAt),
      cadence_seconds: String(NOGIZAKA_LISTENING_PARTY_CADENCE_SECONDS),
    },
  });
  return {
    published: true,
    model_key: NOGIZAKA_LISTENING_PARTY_MODEL_KEY,
    object_key: key,
    collection_active: payload.collection_active,
    has_event: Boolean(payload.event),
    updated_at: updatedAt,
  };
}
