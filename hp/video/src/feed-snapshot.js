import { feedContentHash, writeFeedState } from './d1-compaction.js';
import { PLAYBACK_FEED_LIMIT } from './feed-limits.js';
import { inferVideoOrientation } from './video-orientation.js';
import { runtimeEnvForDb } from './runtime-env.js';
import { buildWeightedPlaybackPage } from './weighted-playback.js';

const SNAPSHOT_KEY = 'video/playback-feed/v2.json';
const SNAPSHOT_SCHEMA_VERSION = 2;
const SNAPSHOT_CACHE_TTL_MS = 5 * 60_000;
const SNAPSHOT_CACHE_URL = 'https://homepanel.internal/video/playback-feed/v2.json';
const SNAPSHOT_CACHES = new WeakMap();

function validItem(value) {
  return value
    && typeof value === 'object'
    && Number.isSafeInteger(Number(value.id))
    && Number(value.id) > 0
    && typeof value.mediaUrl === 'string'
    && typeof value.firstSeenAt === 'string'
    && ['vertical', 'horizontal', 'square', 'unknown'].includes(String(value.orientation));
}

function parseSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || !Array.isArray(value.items)) return null;
  if (!value.items.every(validItem)) return null;
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    contentHash: String(value.contentHash || ''),
    generatedAt: String(value.generatedAt || ''),
    items: value.items.map((item) => ({
      id: Number(item.id),
      mediaUrl: item.mediaUrl,
      firstSeenAt: String(item.firstSeenAt || ''),
      orientation: String(item.orientation)
    }))
  };
}

function cacheApi() {
  return globalThis.caches?.default || null;
}

async function cacheSnapshot(snapshot) {
  const cache = cacheApi();
  if (!cache) return;
  await cache.put(SNAPSHOT_CACHE_URL, new Response(JSON.stringify(snapshot), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300'
    }
  })).catch(() => {});
}

async function readSnapshot(bucket) {
  const cached = SNAPSHOT_CACHES.get(bucket);
  const now = Date.now();
  if (cached?.expiresAt > now) return cached.snapshot;

  const cache = cacheApi();
  if (cache) {
    const response = await cache.match(SNAPSHOT_CACHE_URL).catch(() => null);
    if (response) {
      const snapshot = parseSnapshot(await response.json().catch(() => null));
      if (snapshot) {
        SNAPSHOT_CACHES.set(bucket, { snapshot, expiresAt: now + SNAPSHOT_CACHE_TTL_MS });
        return snapshot;
      }
    }
  }

  const object = await bucket.get(SNAPSHOT_KEY);
  if (!object) return null;
  const snapshot = parseSnapshot(await object.json());
  if (!snapshot) throw new Error('R2 playback feed snapshot is invalid');
  SNAPSHOT_CACHES.set(bucket, { snapshot, expiresAt: now + SNAPSHOT_CACHE_TTL_MS });
  void cacheSnapshot(snapshot);
  return snapshot;
}

export async function readFeedSnapshotPage(db, options) {
  const env = runtimeEnvForDb(db);
  const bucket = env?.DATA_BUCKET;
  if (!bucket) return null;
  let snapshot;
  try {
    snapshot = await readSnapshot(bucket);
  } catch (error) {
    console.error('r2-playback-feed-read-failed', {
      error: String(error?.message || error)
    });
    return null;
  }
  if (!snapshot) return null;

  const limit = Math.max(0, Number(options.limit) || 0);
  if (!limit) return { items: [], nextCursor: null };
  const orientation = String(options.orientation || 'both');
  const candidates = orientation === 'both'
    ? snapshot.items
    : snapshot.items.filter((item) => item.orientation === orientation);
  const snapshotTime = Date.parse(snapshot.generatedAt);
  const page = buildWeightedPlaybackPage(candidates, {
    ...options,
    nowMs: Number.isFinite(snapshotTime) ? snapshotTime : Date.now()
  });
  return {
    items: page.rows.map((item) => ({ id: item.id, mediaUrl: item.mediaUrl })),
    nextCursor: page.nextCursor
  };
}

export async function publishFeedSnapshot(env, rows, contentHash, generatedAt) {
  const bucket = env?.DATA_BUCKET;
  if (!bucket) return { written: false, reason: 'bucket-unavailable' };
  const seen = new Set();
  const items = [];
  for (const row of rows || []) {
    const id = Number(row?.videoId ?? row?.id);
    const mediaUrl = String(row?.mediaUrl || '');
    if (!Number.isSafeInteger(id) || id <= 0 || !mediaUrl || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      mediaUrl,
      firstSeenAt: String(row?.firstSeenAt || ''),
      orientation: inferVideoOrientation(mediaUrl)
    });
  }
  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    contentHash: String(contentHash || ''),
    generatedAt: String(generatedAt || new Date().toISOString()),
    items
  };

  const existing = await bucket.head(SNAPSHOT_KEY);
  const snapshotDay = snapshot.generatedAt.slice(0, 10);
  const existingDay = String(existing?.customMetadata?.generatedAt || '').slice(0, 10);
  const unchanged = existing?.customMetadata?.contentHash === snapshot.contentHash
    && Number(existing?.customMetadata?.rowCount) === snapshot.items.length
    && Number(existing?.customMetadata?.schemaVersion) === SNAPSHOT_SCHEMA_VERSION
    && existingDay === snapshotDay;
  if (!unchanged) {
    await bucket.put(SNAPSHOT_KEY, JSON.stringify(snapshot), {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'private, max-age=300'
      },
      customMetadata: {
        contentHash: snapshot.contentHash,
        rowCount: String(snapshot.items.length),
        generatedAt: snapshot.generatedAt,
        schemaVersion: String(SNAPSHOT_SCHEMA_VERSION)
      }
    });
  }
  SNAPSHOT_CACHES.set(bucket, {
    snapshot,
    expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS
  });
  await cacheSnapshot(snapshot);
  return { written: !unchanged, rowCount: snapshot.items.length };
}

export async function refreshFeedSnapshot(env, generatedAt = new Date().toISOString()) {
  if (!env?.DB) return 0;
  const result = await env.DB.prepare(
    `SELECT ranking.video_id AS videoId,
            video.media_url AS mediaUrl,
            video.first_seen_at AS firstSeenAt
       FROM ranking_entries AS ranking
       INNER JOIN videos AS video ON video.id = ranking.video_id
      WHERE ranking.period = '24h'
        AND video.status = 'active'
      ORDER BY ranking.rank, ranking.video_id
      LIMIT ?`
  ).bind(PLAYBACK_FEED_LIMIT).all();
  const rows = result?.results || [];
  const hash = await feedContentHash(rows);
  await publishFeedSnapshot(env, rows, hash, generatedAt);
  await writeFeedState(env.DB, hash, rows.length, generatedAt);
  return rows.length;
}

export function invalidateFeedSnapshotCache(db) {
  const bucket = runtimeEnvForDb(db)?.DATA_BUCKET;
  if (bucket) SNAPSHOT_CACHES.delete(bucket);
  const cache = cacheApi();
  if (cache) void cache.delete(SNAPSHOT_CACHE_URL).catch(() => {});
}

export { SNAPSHOT_KEY };
