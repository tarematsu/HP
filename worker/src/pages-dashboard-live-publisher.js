import { onRequestGet as renderDashboard } from '../../site/functions/api/dashboard.js';
import { directFiveMinuteStreamHistory } from '../../site/functions/lib/dashboard-chart-support.js';
import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

const FIVE_MINUTES_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const FULL_REFRESH_MS = 6 * 60 * 60_000;
const DASHBOARD_KEY = pagesActionsR2ResponseKey('dashboard');
const DASHBOARD_CADENCE_SECONDS = 5 * 60;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = finite(value);
  return number == null ? null : Math.trunc(number);
}

function positiveInteger(value) {
  const number = integer(value);
  return number != null && number > 0 ? number : null;
}

function bucketAt(value) {
  const timestamp = finite(value);
  return timestamp == null ? null : Math.floor(timestamp / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

function jstCycleStart(now, cutoffHour) {
  const shifted = Number(now) + 9 * 60 * 60_000;
  const date = new Date(shifted);
  let localBoundary = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    cutoffHour,
  );
  if (shifted < localBoundary) localBoundary -= DAY_MS;
  return localBoundary - 9 * 60 * 60_000;
}

function cycleState(now) {
  return {
    member: jstCycleStart(now, 16),
    listens: jstCycleStart(now, 9),
  };
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseEnvelopeObject(object) {
  return object?.json?.().then((envelope) => {
    if (Number(envelope?.version) !== 1 || typeof envelope?.body !== 'string') return null;
    let payload;
    try {
      payload = JSON.parse(envelope.body);
    } catch {
      return null;
    }
    return payload?.ok ? { envelope, payload } : null;
  }).catch(() => null) || Promise.resolve(null);
}

async function loadExisting(bucket) {
  if (typeof bucket?.get !== 'function' || !DASHBOARD_KEY) return null;
  return parseEnvelopeObject(await bucket.get(DASHBOARD_KEY));
}

function snapshotLatest(existing, snapshot, observedAt) {
  const next = { ...(existing || {}) };
  const assignments = {
    observed_at: observedAt,
    channel_id: snapshot?.channel_id,
    channel_alias: snapshot?.channel_alias,
    channel_name: snapshot?.channel_name,
    station_id: snapshot?.station_id,
    is_launched: snapshot?.is_launched,
    is_broadcasting: snapshot?.is_broadcasting,
    chat_status: snapshot?.chat_status,
    listener_count: snapshot?.listener_count,
    online_member_count: snapshot?.online_member_count,
    total_member_count: snapshot?.total_member_count,
    guest_count: snapshot?.guest_count,
    total_listens: snapshot?.total_listens,
    stream_goal: snapshot?.stream_goal,
    current_stream_count: snapshot?.current_stream_count,
    host_account_id: snapshot?.host_account_id,
    host_handle: snapshot?.host_handle,
    broadcast_start_time: snapshot?.broadcast_start_time,
  };
  for (const [key, value] of Object.entries(assignments)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function historyRow(fact, snapshot) {
  const point = bucketAt(fact?.minute_at ?? fact?.observed_at);
  if (point == null) return null;
  return {
    observed_at: point,
    listener_count: integer(fact?.listener_count ?? snapshot?.listener_count),
    online_member_count: integer(fact?.online_member_count ?? snapshot?.online_member_count),
    total_member_count: integer(fact?.total_member_count ?? snapshot?.total_member_count),
    total_listens: integer(fact?.reported_total_listens ?? snapshot?.total_listens),
    current_stream_count: integer(
      fact?.reported_current_stream_count ?? snapshot?.current_stream_count,
    ),
  };
}

function normalizeHistory(rows, currentBucket) {
  const byBucket = new Map();
  const floor = currentBucket - DAY_MS;
  for (const row of Array.isArray(rows) ? rows : []) {
    const point = bucketAt(row?.observed_at);
    if (point == null || point < floor || point > currentBucket) continue;
    byBucket.set(point, { ...row, observed_at: point });
  }
  return [...byBucket.values()].sort((left, right) => left.observed_at - right.observed_at).slice(-300);
}

function mergeCurrentHistory(rows, nextRow, currentBucket) {
  const source = Array.isArray(rows) ? [...rows] : [];
  if (nextRow) source.push(nextRow);
  return normalizeHistory(source, currentBucket);
}

function normalizePreviousDay(rows, evictedRows, currentBucket) {
  const lower = currentBucket - 2 * DAY_MS;
  const upper = currentBucket - DAY_MS;
  const byBucket = new Map();
  for (const row of [...(Array.isArray(rows) ? rows : []), ...(evictedRows || [])]) {
    const point = bucketAt(row?.observed_at);
    if (point == null || point < lower || point > upper) continue;
    byBucket.set(point, {
      observed_at: point,
      online_member_count: finite(row?.online_member_count),
    });
  }
  return [...byBucket.values()].sort((left, right) => left.observed_at - right.observed_at).slice(-300);
}

function updateDailyChange(payload, oldLatest, newLatest) {
  const daily = objectValue(payload?.daily_change);
  if (!daily) return payload?.daily_change ?? null;
  const oldMember = finite(oldLatest?.total_member_count);
  const oldListens = finite(oldLatest?.total_listens);
  const oldMemberDelta = finite(daily.total_member_count);
  const oldListensDelta = finite(daily.total_listens);
  const memberBaseline = oldMember != null && oldMemberDelta != null
    ? oldMember - oldMemberDelta
    : null;
  const listensBaseline = oldListens != null && oldListensDelta != null
    ? oldListens - oldListensDelta
    : null;
  const member = finite(newLatest?.total_member_count);
  const listens = finite(newLatest?.total_listens);
  return {
    ...daily,
    total_member_count: memberBaseline != null && member != null ? member - memberBaseline : daily.total_member_count,
    total_listens: listensBaseline != null && listens != null ? listens - listensBaseline : daily.total_listens,
  };
}

function playbackQueue(queue, now) {
  const tracks = Array.isArray(queue?.tracks) ? queue.tracks : [];
  const startTime = finite(queue?.start_time);
  const paused = Boolean(queue?.is_paused);
  let currentIndex = tracks.length ? 0 : -1;
  let progressMs = 0;
  let anchorAt = startTime;
  let queueEndAt = startTime;
  if (tracks.length && startTime != null) {
    let cursor = 0;
    const elapsed = Math.max(0, now - startTime);
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
  const publicQueue = tracks.map((track, index) => {
    const spotifyId = String(track?.spotify_id || '').trim();
    const trackId = positiveInteger(track?.track_id);
    const item = {
      ...(trackId != null ? { track_id: trackId } : {}),
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
  const totalItems = integer(queue?.total_track_count) ?? tracks.length;
  return {
    queue: publicQueue,
    queue_status: queue ? {
      is_paused: paused,
      playing: tracks.length > 0 && !paused,
      current_index: currentIndex,
      progress_ms: progressMs,
      anchor_at: anchorAt,
      queue_end_at: queueEndAt,
      total_items: totalItems,
      returned_items: publicQueue.length,
      loaded_items: publicQueue.length,
      has_more: publicQueue.length < totalItems,
    } : null,
    queue_revision: queue
      ? `${queue?.queue_id ?? ''}:${queue?.start_time ?? ''}:${queue?.is_paused ? 1 : 0}:${tracks.length}`
      : '',
  };
}

function needsFullRefresh(payload, snapshot, now, cycles) {
  if (!payload?.ok) return true;
  if (integer(payload?.latest?.channel_id) !== integer(snapshot?.channel_id)) return true;
  if (integer(payload?._live_member_cycle_at) !== cycles.member) return true;
  if (integer(payload?._live_listens_cycle_at) !== cycles.listens) return true;
  const fullAt = finite(payload?._live_full_generated_at);
  return fullAt == null || now - fullAt >= FULL_REFRESH_MS;
}

async function fullyRender(env, now) {
  const response = await renderDashboard({
    request: new Request('https://pages-live.invalid/api/dashboard', {
      method: 'GET',
      headers: { accept: 'application/json' },
    }),
    env,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`dashboard full render failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  const payload = JSON.parse(text);
  if (!payload?.ok) throw new Error('dashboard full render returned an invalid payload');
  return payload;
}

function incrementalPayload(base, input, fact, now, cycles, fullGeneratedAt) {
  const snapshot = input?.snapshot || {};
  const oldLatest = objectValue(base?.latest) || {};
  const latest = snapshotLatest(oldLatest, snapshot, finite(fact?.observed_at) ?? now);
  const currentBucket = bucketAt(fact?.minute_at ?? fact?.observed_at ?? now) ?? bucketAt(now);
  const oldHistory = Array.isArray(base?.history) ? base.history : [];
  const evicted = oldHistory.filter((row) => {
    const point = bucketAt(row?.observed_at);
    return point != null && point < currentBucket - DAY_MS;
  });
  const history = mergeCurrentHistory(oldHistory, historyRow(fact, snapshot), currentBucket);
  const previousDay = normalizePreviousDay(base?.previous_day_history, evicted, currentBucket);
  const playback = playbackQueue(input?.queue, now);
  return {
    ...base,
    generated_at: now,
    latest_observed_at: latest.observed_at,
    latest,
    history,
    previous_day_history: previousDay,
    stream_5m_history: directFiveMinuteStreamHistory(history),
    daily_change: updateDailyChange(base, oldLatest, latest),
    queue: playback.queue,
    queue_status: playback.queue_status,
    queue_revision: playback.queue_revision,
    queue_unchanged: false,
    _live_full_generated_at: fullGeneratedAt,
    _live_source_minute_at: currentBucket,
    _live_member_cycle_at: cycles.member,
    _live_listens_cycle_at: cycles.listens,
  };
}

async function purgeDashboardEdgeCache() {
  const cache = globalThis.caches?.default;
  if (!cache?.delete) return;
  for (const url of [
    'https://pages-read-model.internal/_internal/pages-response?key=dashboard',
    'https://pages-read-model.internal/_internal/pages-response?key=dashboard&',
  ]) {
    await cache.delete(new Request(url)).catch(() => {});
  }
}

async function saveEnvelope(bucket, existingEnvelope, payload, now) {
  if (typeof bucket?.put !== 'function' || !DASHBOARD_KEY) return false;
  const envelope = {
    ...(existingEnvelope || {}),
    version: 1,
    status: 200,
    headers: {
      ...(objectValue(existingEnvelope?.headers) || {}),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    updated_at: now,
    cadence_seconds: DASHBOARD_CADENCE_SECONDS,
    body: JSON.stringify(payload),
  };
  await bucket.put(DASHBOARD_KEY, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  await purgeDashboardEdgeCache();
  return true;
}

async function canonicalInput(env, input) {
  const tracks = Array.isArray(input?.queue?.tracks) ? input.queue.tracks : [];
  if (!tracks.length) return input;
  const canonicalTracks = await canonicalizeTrackRows(env?.MINUTE_DB, tracks);
  return { ...input, queue: { ...input.queue, tracks: canonicalTracks } };
}

export async function publishDashboardFromMinuteFact(env, input, fact, options = {}) {
  if (Number(fact?.source_code) !== 1) return { skipped: true, reason: 'not-live' };
  const bucket = env?.PAGES_RESPONSE_R2;
  if (typeof bucket?.get !== 'function' || typeof bucket?.put !== 'function') {
    return { skipped: true, reason: 'pages-r2-binding-missing' };
  }
  const now = Number(options.now?.() ?? Date.now());
  const currentMinute = bucketAt(fact?.minute_at ?? fact?.observed_at);
  const existing = await loadExisting(bucket);
  const existingMinute = finite(existing?.payload?._live_source_minute_at);
  if (currentMinute != null && existingMinute != null && existingMinute >= currentMinute) {
    return { skipped: true, reason: 'already-published', minute_at: currentMinute };
  }
  const canonical = await canonicalInput(env, input);
  const cycles = cycleState(now);
  let base = existing?.payload || null;
  let full = false;
  if (needsFullRefresh(base, canonical?.snapshot, now, cycles)) {
    base = await fullyRender(env, now);
    full = true;
  }
  const fullGeneratedAt = full ? now : finite(base?._live_full_generated_at) ?? now;
  const payload = incrementalPayload(base, canonical, fact, now, cycles, fullGeneratedAt);
  await saveEnvelope(bucket, existing?.envelope, payload, now);
  console.log(JSON.stringify({
    event: 'pages_dashboard_live_published',
    minute_at: currentMinute,
    full_render: full,
    history_rows: payload.history?.length || 0,
  }));
  return {
    skipped: false,
    minute_at: currentMinute,
    full_render: full,
    history_rows: payload.history?.length || 0,
  };
}
