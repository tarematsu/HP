import { onRequestGet as renderDashboard } from '../../site/functions/api/dashboard.js';
import { directFiveMinuteStreamHistory } from '../../site/functions/lib/dashboard-chart-support.js';
import { loadDashboardDailySummaries, utcDayStarts } from '../../site/functions/lib/dashboard-daily-summaries.js';
import { dashboardGoalPredictions } from '../../site/functions/lib/dashboard-legacy.mjs';
import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

const FIVE_MINUTES_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const INCREMENTAL_GAP_LIMIT_MS = 11 * 60_000;
const RECOVERY_GAP_LIMIT_MS = DAY_MS;
const DASHBOARD_KEY = pagesActionsR2ResponseKey('dashboard');
const DASHBOARD_CADENCE_SECONDS = 5 * 60;
export const BUDDIES_DASHBOARD_HOT_STATE_KEY = 'stationhead/buddies/dashboard-hot-state.json';

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

async function readJsonObject(bucket, key) {
  if (!key || typeof bucket?.get !== 'function') return null;
  try {
    const object = await bucket.get(key);
    if (!object) return null;
    if (typeof object.json === 'function') return await object.json();
    if (typeof object.text === 'function') return JSON.parse(await object.text());
    return null;
  } catch {
    return null;
  }
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

async function loadExistingState(bucket) {
  const hot = await readJsonObject(bucket, BUDDIES_DASHBOARD_HOT_STATE_KEY);
  if (Number(hot?.version) === 1 && hot?.payload?.ok) {
    return { payload: hot.payload, source: 'hot' };
  }

  const envelope = await readJsonObject(bucket, DASHBOARD_KEY);
  const payload = payloadFromEnvelope(envelope);
  return payload ? { payload, source: 'public' } : { payload: null, source: 'none' };
}

async function saveHotState(bucket, payload, now) {
  if (typeof bucket?.put !== 'function') return false;
  await bucket.put(BUDDIES_DASHBOARD_HOT_STATE_KEY, JSON.stringify({
    version: 1,
    updated_at: now,
    payload,
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      version: '1',
      model_key: 'dashboard',
      updated_at: String(now),
    },
  });
  return true;
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
    total_listens: snapshot?.total_listens ?? snapshot?.reported_total_listens,
    stream_goal: snapshot?.stream_goal,
    current_stream_count: snapshot?.current_stream_count ?? snapshot?.reported_current_stream_count,
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
  return [...byBucket.values()]
    .sort((left, right) => left.observed_at - right.observed_at)
    .slice(-300);
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
  return [...byBucket.values()]
    .sort((left, right) => left.observed_at - right.observed_at)
    .slice(-300);
}

function updateDailyChange(payload, oldLatest, newLatest, cycles) {
  const daily = objectValue(payload?.daily_change);
  if (!daily) return payload?.daily_change ?? null;
  const previousMemberCycle = integer(payload?._live_member_cycle_at);
  const previousListensCycle = integer(payload?._live_listens_cycle_at);
  const memberCycleChanged = previousMemberCycle != null && previousMemberCycle !== cycles.member;
  const listensCycleChanged = previousListensCycle != null && previousListensCycle !== cycles.listens;

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
    member_baseline_observed_at: memberCycleChanged
      ? newLatest?.observed_at ?? daily.member_baseline_observed_at ?? null
      : daily.member_baseline_observed_at ?? null,
    listens_baseline_observed_at: listensCycleChanged
      ? newLatest?.observed_at ?? daily.listens_baseline_observed_at ?? null
      : daily.listens_baseline_observed_at ?? null,
    total_member_count: memberCycleChanged
      ? (member == null ? null : 0)
      : (memberBaseline != null && member != null ? member - memberBaseline : daily.total_member_count),
    total_listens: listensCycleChanged
      ? (listens == null ? null : 0)
      : (listensBaseline != null && listens != null ? listens - listensBaseline : daily.total_listens),
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

async function fullyRender(env, now) {
  const response = await renderDashboard({
    request: new Request('https://pages-live.invalid/api/dashboard', {
      method: 'GET',
      headers: { accept: 'application/json' },
    }),
    env,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`dashboard bootstrap render failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  const payload = JSON.parse(text);
  if (!payload?.ok) throw new Error('dashboard bootstrap render returned an invalid payload');
  return payload;
}

function observationSnapshot(fact) {
  return {
    channel_id: fact?.channel_id,
    station_id: fact?.station_id,
    is_broadcasting: fact?.is_broadcasting,
    listener_count: fact?.listener_count,
    online_member_count: fact?.online_member_count,
    total_member_count: fact?.total_member_count,
    guest_count: fact?.guest_count,
    reported_total_listens: fact?.reported_total_listens,
    reported_current_stream_count: fact?.reported_current_stream_count,
    broadcast_start_time: fact?.broadcast_start_time,
  };
}

function applyObservation(base, input, fact, observedAt, { updateQueue = false } = {}) {
  const snapshot = input?.snapshot || observationSnapshot(fact);
  const oldLatest = objectValue(base?.latest) || {};
  const latest = snapshotLatest(oldLatest, snapshot, integer(fact?.observed_at) ?? observedAt);
  const currentBucket = bucketAt(fact?.minute_at ?? fact?.observed_at ?? observedAt) ?? bucketAt(observedAt);
  const oldHistory = Array.isArray(base?.history) ? base.history : [];
  const evicted = oldHistory.filter((row) => {
    const point = bucketAt(row?.observed_at);
    return point != null && point < currentBucket - DAY_MS;
  });
  const history = mergeCurrentHistory(oldHistory, historyRow(fact, snapshot), currentBucket);
  const previousDay = normalizePreviousDay(base?.previous_day_history, evicted, currentBucket);
  const cycles = cycleState(observedAt);
  const next = {
    ...base,
    latest_observed_at: latest.observed_at,
    latest,
    history,
    previous_day_history: previousDay,
    daily_change: updateDailyChange(base, oldLatest, latest, cycles),
    queue_unchanged: false,
    _live_source_minute_at: currentBucket,
    _live_member_cycle_at: cycles.member,
    _live_listens_cycle_at: cycles.listens,
  };
  if (updateQueue) {
    const playback = playbackQueue(input?.queue, observedAt);
    next.queue = playback.queue;
    next.queue_status = playback.queue_status;
    next.queue_revision = playback.queue_revision;
  }
  return next;
}

function refreshDerived(payload, now) {
  const history = Array.isArray(payload?.history) ? payload.history : [];
  const current = finite(payload?.latest?.current_stream_count ?? payload?.latest?.total_listens);
  const configuredGoal = finite(payload?.latest?.stream_goal);
  const predictions = dashboardGoalPredictions({
    rows: history,
    current,
    configuredGoal,
    now,
    useAggregate: false,
  });
  return {
    ...payload,
    generated_at: now,
    stream_5m_history: directFiveMinuteStreamHistory(history),
    goal_prediction: predictions.goalPrediction,
    goal_predictions: predictions.goalPredictions,
  };
}

async function refreshDailySummariesIfDue(env, payload, now) {
  const starts = utcDayStarts(now);
  if (integer(payload?.daily_summaries?.current_day_start) === starts.currentStart) return payload;
  const retryAfter = integer(payload?._live_daily_summary_retry_after);
  if (retryAfter != null && retryAfter > now) return payload;
  try {
    const summaries = await loadDashboardDailySummaries(env?.OTHER_DB, now);
    const { _live_daily_summary_retry_after: _ignored, ...rest } = payload;
    return { ...rest, daily_summaries: summaries };
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'pages_dashboard_daily_summary_refresh_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return { ...payload, _live_daily_summary_retry_after: now + HOUR_MS };
  }
}

async function loadGapRows(db, channelId, afterMinute, beforeMinute) {
  if (!db?.prepare) throw new Error('MINUTE_DB binding is missing for dashboard recovery');
  const result = await db.prepare(`SELECT
      channel_id,station_id,minute_at,observed_at,is_broadcasting,
      listener_count,online_member_count,total_member_count,guest_count,
      reported_total_listens,reported_current_stream_count,broadcast_start_time
    FROM sh_minute_facts
    WHERE channel_id=? AND minute_at>? AND minute_at<?
    ORDER BY minute_at ASC,id ASC`)
    .bind(channelId, afterMinute, beforeMinute)
    .all();
  return Array.isArray(result?.results) ? result.results : [];
}

function needsBootstrap(payload, channelId, currentMinute) {
  if (!payload?.ok) return true;
  if (integer(payload?.latest?.channel_id) !== integer(channelId)) return true;
  const previousMinute = bucketAt(payload?._live_source_minute_at ?? payload?.latest_observed_at);
  if (previousMinute == null || currentMinute == null) return true;
  return currentMinute - previousMinute > RECOVERY_GAP_LIMIT_MS || currentMinute < previousMinute;
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

async function savePublicEnvelope(bucket, payload, now) {
  if (typeof bucket?.put !== 'function' || !DASHBOARD_KEY) return false;
  const envelope = {
    version: 1,
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    updated_at: now,
    cadence_seconds: DASHBOARD_CADENCE_SECONDS,
    body: JSON.stringify(payload),
  };
  await bucket.put(DASHBOARD_KEY, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      version: '1',
      model_key: 'dashboard',
      updated_at: String(now),
      cadence_seconds: String(DASHBOARD_CADENCE_SECONDS),
    },
  });
  await purgeDashboardEdgeCache();
  return true;
}

async function canonicalInput(env, input) {
  const tracks = Array.isArray(input?.queue?.tracks) ? input.queue.tracks : [];
  if (!tracks.length || tracks.every((track) => positiveInteger(track?.track_id) != null)) return input;
  const seedRows = tracks.filter((track) => positiveInteger(track?.track_id) != null);
  const canonicalTracks = await canonicalizeTrackRows(env?.MINUTE_DB, tracks, { seedRows });
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
  const channelId = integer(fact?.channel_id ?? input?.snapshot?.channel_id);
  const existing = await loadExistingState(bucket);
  let base = existing.payload;
  let mode = 'incremental';
  let recoveryRows = 0;

  if (base && !needsBootstrap(base, channelId, currentMinute)) {
    const existingMinute = bucketAt(base?._live_source_minute_at ?? base?.latest_observed_at);
    if (currentMinute != null && existingMinute != null && existingMinute >= currentMinute) {
      if (existing.source === 'public') await saveHotState(bucket, base, now);
      return {
        skipped: true,
        reason: 'already-published',
        minute_at: currentMinute,
        state_seeded: existing.source === 'public',
      };
    }

    const gap = currentMinute != null && existingMinute != null ? currentMinute - existingMinute : null;
    if (gap != null && gap > INCREMENTAL_GAP_LIMIT_MS && gap <= RECOVERY_GAP_LIMIT_MS) {
      const rows = await loadGapRows(env?.MINUTE_DB, channelId, existingMinute, currentMinute);
      recoveryRows = rows.length;
      for (const row of rows) {
        const rowAt = integer(row?.observed_at ?? row?.minute_at);
        if (rowAt == null) continue;
        base = applyObservation(base, null, row, rowAt, { updateQueue: false });
      }
      mode = 'recovery';
    }
  } else {
    base = await fullyRender(env, now);
    const cycles = cycleState(now);
    base = {
      ...base,
      _live_bootstrap_generated_at: now,
      _live_member_cycle_at: cycles.member,
      _live_listens_cycle_at: cycles.listens,
    };
    mode = 'bootstrap';
  }

  const canonical = await canonicalInput(env, input);
  let payload = applyObservation(base, canonical, fact, integer(fact?.observed_at) ?? now, {
    updateQueue: true,
  });
  payload = refreshDerived(payload, now);
  payload = await refreshDailySummariesIfDue(env, payload, now);

  await saveHotState(bucket, payload, now);
  await savePublicEnvelope(bucket, payload, now);
  console.log(JSON.stringify({
    event: 'pages_dashboard_live_published',
    minute_at: currentMinute,
    mode,
    recovery_rows: recoveryRows,
    history_rows: payload.history?.length || 0,
  }));
  return {
    skipped: false,
    minute_at: currentMinute,
    mode,
    recovery_rows: recoveryRows,
    history_rows: payload.history?.length || 0,
  };
}
