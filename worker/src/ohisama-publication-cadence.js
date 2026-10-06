import { OHISAMA_PAGES_CADENCE_SECONDS } from './ohisama-read-model.js';
import { loadMaterializedR2Json, saveMaterializedR2Response } from './pages-response-r2.js';

const MINUTE_MS = 60_000;
export const OHISAMA_CURRENT_CADENCE_MS = 5 * MINUTE_MS;
export const OHISAMA_HISTORY_CADENCE_MS = 24 * 60 * MINUTE_MS;
export const OHISAMA_LIKES_CADENCE_MS = 6 * 60 * MINUTE_MS;

const DEFAULT_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});
const SECTION_CADENCE_MS = Object.freeze({
  current: OHISAMA_CURRENT_CADENCE_MS,
  history: OHISAMA_HISTORY_CADENCE_MS,
  likes: OHISAMA_LIKES_CADENCE_MS,
});

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

export async function loadOhisamaPublicationSnapshot(r2) {
  const payload = await loadMaterializedR2Json(r2, 'hinata').catch(() => null);
  return payload?.model === 'hinata' ? payload : null;
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
  const likesDue = ohisamaSectionDue(previousPayload, 'likes', timestamp);
  const likesRefreshed = likesDue && Array.isArray(playback?.likes);

  const previousHistoryAt = previousSectionTimestamp(previousPayload, 'history', timestamp);
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

  delete next.played_tracks;
  delete next.played_history;

  if (likesRefreshed) {
    next.likes = playback.likes;
  } else if (previousPayload) {
    next.likes = preserved(previousPayload, 'likes', currentPayload.likes || []);
  }

  next.section_updated_at = {
    ...(previousPayload?.section_updated_at || {}),
    current: timestamp,
    history: historyDue ? timestamp : previousHistoryAt,
    likes: likesRefreshed ? timestamp : previousLikesAt,
  };

  return {
    payload: next,
    refreshed: {
      current: true,
      history: historyDue,
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
  if (typeof bucket?.get !== 'function' || typeof bucket?.put !== 'function') {
    return { published: false, refreshed: {} };
  }

  const currentPayload = currentPayloadOverride?.model === 'hinata'
    ? currentPayloadOverride
    : await loadOhisamaPublicationSnapshot(bucket);
  if (!currentPayload) return { published: false, refreshed: {} };

  const built = buildOhisamaCadencedPayload(
    currentPayload,
    previousPayload,
    playback,
    collection,
    observedAt,
  );
  const saved = await saveMaterializedR2Response(
    bucket,
    'hinata',
    JSON.stringify(built.payload),
    200,
    DEFAULT_HEADERS,
    integer(observedAt),
    OHISAMA_PAGES_CADENCE_SECONDS,
    { model_key: 'hinata' },
  );
  if (!saved) return { published: false, refreshed: {} };
  return {
    published: true,
    refreshed: built.refreshed,
    section_updated_at: built.payload.section_updated_at,
  };
}
