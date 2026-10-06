import { OHISAMA_PAGES_CADENCE_SECONDS } from './ohisama-read-model.js';
import { pagesR2ResponseKey } from './pages-response-r2.js';

const MINUTE_MS = 60_000;
export const OHISAMA_CURRENT_CADENCE_MS = 5 * MINUTE_MS;
export const OHISAMA_HISTORY_CADENCE_MS = 24 * 60 * MINUTE_MS;
export const OHISAMA_PLAYED_CADENCE_MS = 24 * 60 * MINUTE_MS;
export const OHISAMA_LIKES_CADENCE_MS = 6 * 60 * MINUTE_MS;

const OHISAMA_PAGES_KEY = pagesR2ResponseKey('hinata');
const DEFAULT_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});
const SECTION_CADENCE_MS = Object.freeze({
  current: OHISAMA_CURRENT_CADENCE_MS,
  history: OHISAMA_HISTORY_CADENCE_MS,
  played_tracks: OHISAMA_PLAYED_CADENCE_MS,
  likes: OHISAMA_LIKES_CADENCE_MS,
});

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function bodyPayload(envelope) {
  if (!envelope || Number(envelope.version) !== 1) return null;
  try {
    const payload = typeof envelope.body === 'string' ? JSON.parse(envelope.body) : envelope.body;
    return payload?.model === 'hinata' ? payload : null;
  } catch {
    return null;
  }
}

async function loadEnvelope(r2) {
  if (!OHISAMA_PAGES_KEY || typeof r2?.get !== 'function') return null;
  const object = await r2.get(OHISAMA_PAGES_KEY);
  if (!object || typeof object.json !== 'function') return null;
  try {
    return await object.json();
  } catch {
    return null;
  }
}

export async function loadOhisamaPublicationSnapshot(r2) {
  return bodyPayload(await loadEnvelope(r2));
}

function previousSectionTimestamp(previous, section, now) {
  const explicit = integer(previous?.section_updated_at?.[section]);
  if (explicit != null && explicit > 0) return explicit;
  const fallback = integer(previous?.updated_at);
  if (fallback != null && fallback > 0) return fallback;
  return integer(now);
}

export function ohisamaSectionDue(previous, section, now = Date.now()) {
  if (!previous) return true;
  if (section === 'current') return true;
  const cadence = SECTION_CADENCE_MS[section];
  if (!Number.isFinite(cadence) || cadence <= 0) return true;
  const timestamp = integer(now);
  const previousAt = previousSectionTimestamp(previous, section, timestamp);
  if (timestamp == null || previousAt == null || previousAt > timestamp) return true;
  return timestamp - previousAt >= cadence;
}

function mergePlayedHistory(existing, current, completed) {
  const byKey = new Map();
  for (const row of Array.isArray(existing) ? existing : []) {
    if (row?.period_key) byKey.set(String(row.period_key), row);
  }
  if (completed?.period_key) byKey.set(String(completed.period_key), completed);
  if (current?.period_key) byKey.set(String(current.period_key), current);
  return [...byKey.values()]
    .sort((left, right) => String(right.period_key || '').localeCompare(String(left.period_key || '')))
    .slice(0, 90);
}

function preserved(previous, key, fallback) {
  return previous && Object.prototype.hasOwnProperty.call(previous, key)
    ? previous[key]
    : fallback;
}

export function buildOhisamaCadencedPayload(
  currentPayload,
  previousPayload,
  playback,
  collection,
  observedAt = Date.now(),
) {
  if (!currentPayload || currentPayload.model !== 'hinata') {
    throw new Error('ohisama current read model is missing');
  }
  const timestamp = integer(observedAt);
  if (timestamp == null) throw new Error('ohisama publication timestamp is invalid');

  const historyDue = ohisamaSectionDue(previousPayload, 'history', timestamp);
  const playedDue = ohisamaSectionDue(previousPayload, 'played_tracks', timestamp);
  const likesDue = ohisamaSectionDue(previousPayload, 'likes', timestamp);
  const playedRefreshed = playedDue && Boolean(playback?.daily || playback?.completed_day);
  const likesRefreshed = likesDue && Array.isArray(playback?.likes);

  const previousHistoryAt = previousSectionTimestamp(previousPayload, 'history', timestamp);
  const previousPlayedAt = previousSectionTimestamp(previousPayload, 'played_tracks', timestamp);
  const previousLikesAt = previousSectionTimestamp(previousPayload, 'likes', timestamp);

  const next = {
    ...currentPayload,
    updated_at: timestamp,
    latest: {
      ...(currentPayload.latest || {}),
      host_handle: collection?.host_handle || currentPayload.latest?.host_handle || previousPayload?.latest?.host_handle || null,
    },
    queue: playback?.queue || currentPayload.queue || previousPayload?.queue || [],
    queue_status: playback?.queue_status || currentPayload.queue_status || previousPayload?.queue_status || null,
    queue_revision: playback?.queue_revision || currentPayload.queue_revision || previousPayload?.queue_revision || '',
  };

  if (!historyDue && previousPayload) {
    next.daily = preserved(previousPayload, 'daily', currentPayload.daily || []);
    next.weekly = preserved(previousPayload, 'weekly', currentPayload.weekly || []);
  }

  if (playedRefreshed) {
    next.played_tracks = playback.daily || null;
    next.played_history = mergePlayedHistory(
      currentPayload.played_history || previousPayload?.played_history,
      playback.daily,
      playback.completed_day,
    );
  } else if (previousPayload) {
    next.played_tracks = preserved(previousPayload, 'played_tracks', currentPayload.played_tracks || null);
    next.played_history = preserved(previousPayload, 'played_history', currentPayload.played_history || []);
  }

  if (likesRefreshed) {
    next.likes = playback.likes;
  } else if (previousPayload) {
    next.likes = preserved(previousPayload, 'likes', currentPayload.likes || []);
  }

  next.section_updated_at = {
    ...(previousPayload?.section_updated_at || {}),
    current: timestamp,
    history: historyDue ? timestamp : previousHistoryAt,
    played_tracks: playedRefreshed ? timestamp : previousPlayedAt,
    likes: likesRefreshed ? timestamp : previousLikesAt,
  };

  return {
    payload: next,
    refreshed: {
      current: true,
      history: historyDue,
      played_tracks: playedRefreshed,
      likes: likesRefreshed,
    },
  };
}

export async function mergeOhisamaPlaybackReadModelWithCadence(
  env,
  playback,
  collection,
  observedAt = Date.now(),
  previousPayload = null,
  currentPayloadOverride = null,
) {
  const bucket = env?.PAGES_RESPONSE_R2;
  if (!OHISAMA_PAGES_KEY || typeof bucket?.get !== 'function' || typeof bucket?.put !== 'function') {
    return { published: false, refreshed: {} };
  }

  const existingEnvelope = await loadEnvelope(bucket);
  const currentPayload = currentPayloadOverride?.model === 'hinata'
    ? currentPayloadOverride
    : bodyPayload(existingEnvelope);
  if (!currentPayload) return { published: false, refreshed: {} };

  const built = buildOhisamaCadencedPayload(
    currentPayload,
    previousPayload,
    playback,
    collection,
    observedAt,
  );
  const nextEnvelope = {
    version: 1,
    status: Number(existingEnvelope?.status) || 200,
    headers: existingEnvelope?.headers || DEFAULT_HEADERS,
    ...existingEnvelope,
    updated_at: integer(observedAt),
    cadence_seconds: OHISAMA_PAGES_CADENCE_SECONDS,
    body: JSON.stringify(built.payload),
  };
  await bucket.put(OHISAMA_PAGES_KEY, JSON.stringify(nextEnvelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      version: '1',
      model_key: 'hinata',
      updated_at: String(integer(observedAt)),
      cadence_seconds: String(OHISAMA_PAGES_CADENCE_SECONDS),
    },
  });
  return {
    published: true,
    refreshed: built.refreshed,
    section_updated_at: built.payload.section_updated_at,
  };
}
