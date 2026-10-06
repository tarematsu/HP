import { loadMaterializedR2Json, saveMaterializedR2Response } from './pages-response-r2.js';

export const STATIONHEAD_LIKES_DEFAULT_CADENCE_MS = 6 * 60 * 60_000;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function text(value, limit = 500) {
  const parsed = String(value ?? '').trim();
  return parsed ? parsed.slice(0, limit) : null;
}

export function stationheadLikesModelKey(sourceValue) {
  const source = String(sourceValue || '').trim().toLowerCase();
  return source ? `track-likes:${source}` : null;
}

export function stationheadLikeRanking(likes) {
  const rows = Array.isArray(likes) ? likes : Object.values(likes || {});
  return rows.map((row) => ({
    track_id: integer(row?.track_id),
    track_key: text(row?.track_key),
    spotify_id: text(row?.spotify_id),
    isrc: text(row?.isrc)?.toUpperCase() || null,
    title: text(row?.title),
    artist: text(row?.artist),
    thumbnail_url: text(row?.thumbnail_url, 2_048),
    like_count: integer(row?.like_count),
    observed_at: integer(row?.observed_at),
  })).filter((row) => row.track_id != null && row.like_count != null)
    .sort((left, right) => (right.like_count - left.like_count)
      || ((right.observed_at || 0) - (left.observed_at || 0))
      || ((left.track_id || 0) - (right.track_id || 0)));
}

export async function publishStationheadLikesReadModel(
  r2,
  source,
  likes,
  observedAt = Date.now(),
  { cadenceMs = STATIONHEAD_LIKES_DEFAULT_CADENCE_MS } = {},
) {
  const modelKey = stationheadLikesModelKey(source);
  if (!modelKey || typeof r2?.put !== 'function') return { published: false, reason: 'r2-unavailable' };
  const now = integer(observedAt) ?? Date.now();
  const existing = await loadMaterializedR2Json(r2, modelKey).catch(() => null);
  const previousAt = integer(existing?.updated_at);
  if (previousAt != null && now >= previousAt && now - previousAt < cadenceMs) {
    return { published: false, reason: 'cadence', payload: existing };
  }

  const ranking = stationheadLikeRanking(likes);
  const latestObservedAt = ranking.reduce(
    (maximum, row) => Math.max(maximum, integer(row.observed_at) || 0),
    0,
  ) || null;
  const payload = {
    ok: true,
    mode: 'likes',
    source: String(source || '').trim().toLowerCase(),
    updated_at: now,
    ranking_scope: 'all-time-latest-counter',
    ranking,
    ranking_summary: {
      track_count: ranking.length,
      latest_observed_at: latestObservedAt,
    },
  };
  const saved = await saveMaterializedR2Response(
    r2,
    modelKey,
    JSON.stringify(payload),
    200,
    {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
    },
    now,
    Math.max(1, Math.floor(cadenceMs / 1000)),
    { model_key: modelKey, source: payload.source },
  );
  return { published: Boolean(saved), reason: saved ? 'updated' : 'r2-unavailable', payload };
}
