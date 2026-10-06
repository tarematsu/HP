import { directFiveMinuteStreamHistory } from '../../site/functions/lib/dashboard-chart-support.js';
import { pagesR2ResponseKey } from './pages-response-r2.js';

const FIVE_MINUTES_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const DASHBOARD_KEY = pagesR2ResponseKey('dashboard');
const DASHBOARD_CADENCE_SECONDS = 5 * 60;
const HOT_STATE_KEY = 'stationhead/buddies/dashboard-hot-state.json';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = finite(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function bucketAt(value) {
  const parsed = finite(value);
  return parsed == null ? null : Math.floor(parsed / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

async function readJson(bucket, key) {
  if (!key || typeof bucket?.get !== 'function') return null;
  try {
    const object = await bucket.get(key);
    if (!object) return null;
    if (typeof object.json === 'function') return await object.json();
    if (typeof object.text === 'function') return JSON.parse(await object.text());
  } catch {
    // The fallback must never depend on a readable previous object.
  }
  return null;
}

function payloadFromEnvelope(envelope) {
  if (Number(envelope?.version) !== 1) return null;
  try {
    const payload = typeof envelope?.body === 'string' ? JSON.parse(envelope.body) : envelope?.body;
    return payload?.ok ? payload : null;
  } catch {
    return null;
  }
}

async function loadBase(bucket) {
  const hot = await readJson(bucket, HOT_STATE_KEY);
  if (Number(hot?.version) === 1 && hot?.payload?.ok) return hot.payload;
  return payloadFromEnvelope(await readJson(bucket, DASHBOARD_KEY));
}

function latestFrom(base, input, fact, observedAt) {
  const snapshot = input?.snapshot || {};
  const latest = { ...(base?.latest || {}) };
  const values = {
    observed_at: integer(fact?.observed_at) ?? observedAt,
    channel_id: fact?.channel_id ?? snapshot.channel_id,
    channel_alias: snapshot.channel_alias,
    channel_name: snapshot.channel_name,
    station_id: fact?.station_id ?? snapshot.station_id,
    is_launched: snapshot.is_launched,
    is_broadcasting: fact?.is_broadcasting ?? snapshot.is_broadcasting,
    chat_status: snapshot.chat_status,
    listener_count: fact?.listener_count ?? snapshot.listener_count,
    online_member_count: fact?.online_member_count ?? snapshot.online_member_count,
    total_member_count: fact?.total_member_count ?? snapshot.total_member_count,
    guest_count: fact?.guest_count ?? snapshot.guest_count,
    total_listens: fact?.reported_total_listens ?? snapshot.total_listens,
    stream_goal: snapshot.stream_goal,
    current_stream_count: fact?.reported_current_stream_count ?? snapshot.current_stream_count,
    host_account_id: snapshot.host_account_id,
    host_handle: snapshot.host_handle,
    broadcast_start_time: fact?.broadcast_start_time ?? snapshot.broadcast_start_time,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) latest[key] = value;
  }
  return latest;
}

function historyFrom(base, fact, latest, currentMinute) {
  const floor = currentMinute - DAY_MS;
  const byMinute = new Map();
  for (const row of Array.isArray(base?.history) ? base.history : []) {
    const point = bucketAt(row?.observed_at);
    if (point == null || point < floor || point > currentMinute) continue;
    byMinute.set(point, { ...row, observed_at: point });
  }
  byMinute.set(currentMinute, {
    observed_at: currentMinute,
    listener_count: integer(fact?.listener_count ?? latest.listener_count),
    online_member_count: integer(fact?.online_member_count ?? latest.online_member_count),
    total_member_count: integer(fact?.total_member_count ?? latest.total_member_count),
    total_listens: integer(fact?.reported_total_listens ?? latest.total_listens),
    current_stream_count: integer(
      fact?.reported_current_stream_count ?? latest.current_stream_count,
    ),
  });
  return [...byMinute.values()]
    .sort((left, right) => left.observed_at - right.observed_at)
    .slice(-300);
}

function queueFromInput(input, observedAt) {
  const source = input?.queue;
  if (!source || !Array.isArray(source.tracks)) return null;
  const tracks = source.tracks;
  const startTime = finite(source.start_time);
  const paused = Boolean(source.is_paused);
  let currentIndex = tracks.length ? 0 : -1;
  let progressMs = 0;
  let anchorAt = startTime;
  let queueEndAt = startTime;
  if (tracks.length && startTime != null) {
    const elapsed = Math.max(0, observedAt - startTime);
    let cursor = 0;
    let total = 0;
    for (const track of tracks) total += Math.max(0, finite(track?.duration_ms) || 0);
    queueEndAt = startTime + total;
    for (let index = 0; index < tracks.length; index += 1) {
      const duration = Math.max(0, finite(tracks[index]?.duration_ms) || 0);
      if (elapsed < cursor + duration || index === tracks.length - 1) {
        currentIndex = index;
        progressMs = Math.max(0, Math.min(duration, elapsed - cursor));
        anchorAt = startTime + cursor;
        break;
      }
      cursor += duration;
    }
  }
  const queue = tracks.map((track, index) => {
    const trackId = integer(track?.track_id);
    const spotifyId = String(track?.spotify_id || '').trim();
    const item = {
      ...(trackId != null && trackId > 0 ? { track_id: trackId } : {}),
      title: track?.title ?? null,
      artist: track?.artist ?? null,
      thumbnail_url: track?.thumbnail_url ?? null,
      duration_ms: Math.max(0, finite(track?.duration_ms) || 0),
    };
    if (spotifyId) item.spotify_url = `https://open.spotify.com/track/${spotifyId}`;
    if (index === currentIndex) {
      const bites = finite(track?.bite_count);
      if (bites != null) item.bite_count = bites;
      item.is_current = true;
      item.progress_ms = progressMs;
    }
    return item;
  });
  const totalItems = integer(source.total_track_count) ?? tracks.length;
  return {
    queue,
    queue_status: {
      is_paused: paused,
      playing: tracks.length > 0 && !paused,
      current_index: currentIndex,
      progress_ms: progressMs,
      anchor_at: anchorAt,
      queue_end_at: queueEndAt,
      total_items: totalItems,
      returned_items: queue.length,
      loaded_items: queue.length,
      has_more: queue.length < totalItems,
    },
    queue_revision: `${source.queue_id ?? ''}:${source.start_time ?? ''}:${paused ? 1 : 0}:${tracks.length}`,
  };
}

async function purgeDashboardCache() {
  const cache = globalThis.caches?.default;
  if (!cache?.delete) return;
  await cache.delete(new Request(
    'https://pages-read-model.internal/_internal/pages-response?key=dashboard',
  )).catch(() => {});
}

async function persist(bucket, payload, now) {
  await bucket.put(HOT_STATE_KEY, JSON.stringify({
    version: 1,
    updated_at: now,
    payload,
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { version: '1', model_key: 'dashboard', updated_at: String(now) },
  });
  await bucket.put(DASHBOARD_KEY, JSON.stringify({
    version: 1,
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    updated_at: now,
    cadence_seconds: DASHBOARD_CADENCE_SECONDS,
    body: JSON.stringify(payload),
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      version: '1',
      model_key: 'dashboard',
      updated_at: String(now),
      cadence_seconds: String(DASHBOARD_CADENCE_SECONDS),
    },
  });
  await purgeDashboardCache();
}

export async function publishDashboardFallbackFromMinuteFact(env, input, fact, options = {}) {
  const bucket = env?.PAGES_RESPONSE_R2;
  if (Number(fact?.source_code) !== 1) return { skipped: true, reason: 'not-live' };
  if (typeof bucket?.get !== 'function' || typeof bucket?.put !== 'function') {
    return { skipped: true, reason: 'pages-r2-binding-missing' };
  }

  const now = Number(options.now?.() ?? Date.now());
  const observedAt = integer(fact?.observed_at) ?? now;
  const currentMinute = bucketAt(fact?.minute_at ?? observedAt);
  if (currentMinute == null) return { skipped: true, reason: 'minute-missing' };

  const base = await loadBase(bucket) || {
    ok: true,
    latest: {},
    history: [],
    previous_day_history: [],
    stream_5m_history: [],
    daily_change: null,
    daily_summaries: null,
    queue: [],
    queue_status: null,
    queue_revision: '',
  };
  const latest = latestFrom(base, input, fact, observedAt);
  const history = historyFrom(base, fact, latest, currentMinute);
  const playback = queueFromInput(input, observedAt);
  const payload = {
    ...base,
    ok: true,
    generated_at: now,
    latest_observed_at: latest.observed_at,
    latest,
    history,
    stream_5m_history: directFiveMinuteStreamHistory(history),
    _live_source_minute_at: currentMinute,
    _live_fallback_at: now,
    ...(playback || {}),
  };

  await persist(bucket, payload, now);
  console.warn(JSON.stringify({
    event: 'pages_dashboard_live_fallback_published',
    minute_at: currentMinute,
    cause: String(options.cause?.message || options.cause || '').slice(0, 500) || null,
    history_rows: history.length,
  }));
  return {
    skipped: false,
    minute_at: currentMinute,
    mode: 'fallback',
    history_rows: history.length,
  };
}

export default { publishDashboardFallbackFromMinuteFact };
