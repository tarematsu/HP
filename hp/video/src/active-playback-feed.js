import {
  matchesVideoOrientationFilter,
  normalizeVideoOrientationFilter
} from './video-orientation.js';
import {
  invalidateFeedSnapshotCache,
  readFeedSnapshotPage
} from './feed-snapshot.js';
import { buildWeightedPlaybackPage } from './weighted-playback.js';

const MAX_PAGE_SIZE = 100;
const FALLBACK_CACHE_TTL_MS = 5 * 60_000;
const FALLBACK_CACHE_URL = 'https://homepanel.internal/video/active-playback/d1-fallback-v1.json';
const fallbackRowsCaches = new WeakMap();

function pageLimit(value) {
  const parsed = Math.trunc(Number(value) || 0);
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parsed || MAX_PAGE_SIZE));
}

function cacheApi() {
  return globalThis.caches?.default || null;
}

function validFallbackRow(value) {
  return value
    && typeof value === 'object'
    && Number.isSafeInteger(Number(value.id))
    && Number(value.id) > 0
    && typeof value.mediaUrl === 'string'
    && typeof value.firstSeenAt === 'string';
}

function parseFallbackSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!Array.isArray(value.rows) || !value.rows.every(validFallbackRow)) return null;
  const generatedAt = String(value.generatedAt || '');
  if (!Number.isFinite(Date.parse(generatedAt))) return null;
  return {
    generatedAt,
    rows: value.rows.map((row) => ({
      id: Number(row.id),
      mediaUrl: row.mediaUrl,
      firstSeenAt: row.firstSeenAt
    }))
  };
}

async function readSharedFallbackSnapshot() {
  const cache = cacheApi();
  if (!cache) return null;
  const response = await cache.match(FALLBACK_CACHE_URL).catch(() => null);
  if (!response) return null;
  return parseFallbackSnapshot(await response.json().catch(() => null));
}

async function writeSharedFallbackSnapshot(snapshot) {
  const cache = cacheApi();
  if (!cache) return;
  await cache.put(FALLBACK_CACHE_URL, new Response(JSON.stringify(snapshot), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300'
    }
  })).catch(() => {});
}

export function activePlaybackRowsStatement(db) {
  return db.prepare(
    `SELECT video.id AS id,
            video.media_url AS mediaUrl,
            video.first_seen_at AS firstSeenAt
       FROM videos AS video
      WHERE video.status = 'active'
      ORDER BY video.id`
  );
}

async function readFallbackSnapshot(db) {
  const now = Date.now();
  const local = fallbackRowsCaches.get(db);
  if (local?.expiresAt > now) return local.snapshot;

  const shared = await readSharedFallbackSnapshot();
  if (shared) {
    fallbackRowsCaches.set(db, {
      snapshot: shared,
      expiresAt: now + FALLBACK_CACHE_TTL_MS
    });
    return shared;
  }

  const result = await activePlaybackRowsStatement(db).all();
  const snapshot = {
    generatedAt: new Date(now).toISOString(),
    rows: (result?.results || []).map((row) => ({
      id: Number(row.id),
      mediaUrl: String(row.mediaUrl || ''),
      firstSeenAt: String(row.firstSeenAt || '')
    })).filter(validFallbackRow)
  };
  fallbackRowsCaches.set(db, {
    snapshot,
    expiresAt: now + FALLBACK_CACHE_TTL_MS
  });
  void writeSharedFallbackSnapshot(snapshot);
  return snapshot;
}

export function invalidateAllActivePlaybackCache(db) {
  invalidateFeedSnapshotCache(db);
  if (db && (typeof db === 'object' || typeof db === 'function')) fallbackRowsCaches.delete(db);
  const cache = cacheApi();
  if (cache) void cache.delete(FALLBACK_CACHE_URL).catch(() => {});
}

export async function readAllActivePlaybackCursorPage(db, options = {}) {
  const limit = pageLimit(options.limit);
  const orientation = normalizeVideoOrientationFilter(options.orientation);
  const snapshot = await readFeedSnapshotPage(db, {
    ...options,
    limit,
    orientation
  });
  if (snapshot) return snapshot;

  const fallback = await readFallbackSnapshot(db);
  const candidates = orientation === 'both'
    ? fallback.rows
    : fallback.rows.filter((row) => matchesVideoOrientationFilter(row.mediaUrl, orientation));
  const generatedAtMs = Date.parse(fallback.generatedAt);
  const page = buildWeightedPlaybackPage(candidates, {
    ...options,
    limit,
    nowMs: Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now()
  });
  return {
    items: page.rows.map((row) => ({ id: row.id, mediaUrl: row.mediaUrl })),
    nextCursor: page.nextCursor
  };
}
