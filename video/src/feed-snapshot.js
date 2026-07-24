import {
  collectPlaybackCursorPage,
  parsePlaybackCursor
} from './playback-cursor.js';
import { inferVideoOrientation } from './video-orientation.js';
import { runtimeEnvForDb } from './runtime-env.js';

const SNAPSHOT_KEY = 'video/playback-feed/v1.json';
const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_CACHE_TTL_MS = 5 * 60_000;
const SHUFFLE_MODULUS = 2_147_483_647;
const SHUFFLE_MULTIPLIER = 1_103_515_245n;
const SHUFFLE_MODULUS_BIGINT = 2_147_483_647n;
const SNAPSHOT_CACHES = new WeakMap();

function videoShuffleKey(videoId) {
  let value;
  try {
    value = BigInt(videoId);
  } catch {
    value = 0n;
  }
  const normalized = ((value % SHUFFLE_MODULUS_BIGINT) + SHUFFLE_MODULUS_BIGINT)
    % SHUFFLE_MODULUS_BIGINT;
  return Number((normalized * SHUFFLE_MULTIPLIER) % SHUFFLE_MODULUS_BIGINT);
}

function seedShufflePivot(seed) {
  const shift = (Number(seed) * 12_345) % SHUFFLE_MODULUS;
  return shift === 0 ? 0 : SHUFFLE_MODULUS - shift;
}

function validItem(value) {
  return value
    && typeof value === 'object'
    && Number.isSafeInteger(Number(value.id))
    && Number(value.id) > 0
    && typeof value.mediaUrl === 'string'
    && Number.isSafeInteger(Number(value.shuffleKey))
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
      shuffleKey: Number(item.shuffleKey),
      orientation: String(item.orientation)
    }))
  };
}

async function readSnapshot(bucket) {
  const cached = SNAPSHOT_CACHES.get(bucket);
  const now = Date.now();
  if (cached?.expiresAt > now) return cached.snapshot;
  const object = await bucket.get(SNAPSHOT_KEY);
  if (!object) return null;
  const snapshot = parseSnapshot(await object.json());
  if (!snapshot) throw new Error('R2 playback feed snapshot is invalid');
  SNAPSHOT_CACHES.set(bucket, { snapshot, expiresAt: now + SNAPSHOT_CACHE_TTL_MS });
  return snapshot;
}

function rowAfterCursor(item, cursor) {
  if (!cursor) return true;
  return item.shuffleKey > cursor.shuffleKey
    || (item.shuffleKey === cursor.shuffleKey && item.id > cursor.videoId);
}

function phaseRows(items, phase, pivot, cursor, requested, orientation) {
  const rows = [];
  for (const item of items) {
    if (phase === 0 ? item.shuffleKey < pivot : item.shuffleKey >= pivot) continue;
    if (!rowAfterCursor(item, cursor)) continue;
    if (orientation !== 'both' && item.orientation !== orientation) continue;
    rows.push(item);
    if (rows.length >= requested) break;
  }
  return rows;
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
  const pivot = seedShufflePivot(options.seed);
  const orientation = String(options.orientation || 'both');
  const page = await collectPlaybackCursorPage(
    limit,
    options.cursor,
    async (phase, cursor, requested) => phaseRows(
      snapshot.items,
      phase,
      pivot,
      cursor,
      requested,
      orientation
    )
  );
  return {
    items: page.rows.map((item) => ({ id: item.id, mediaUrl: item.mediaUrl })),
    nextCursor: page.nextCursor
  };
}

async function emitSnapshotEvent(env, snapshot, written) {
  const pipeline = env?.HOMEPANEL_PIPELINE;
  if (!pipeline?.send) return;
  try {
    await pipeline.send([{
      schemaVersion: 1,
      eventType: 'video_feed_snapshot',
      occurredAt: snapshot.generatedAt,
      contentHash: snapshot.contentHash,
      rowCount: snapshot.items.length,
      written
    }]);
  } catch (error) {
    console.error('video-feed-pipeline-send-failed', {
      error: String(error?.message || error)
    });
  }
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
      shuffleKey: videoShuffleKey(id),
      orientation: inferVideoOrientation(mediaUrl)
    });
  }
  items.sort((left, right) => left.shuffleKey - right.shuffleKey || left.id - right.id);
  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    contentHash: String(contentHash || ''),
    generatedAt: String(generatedAt || new Date().toISOString()),
    items
  };

  const existing = await bucket.head(SNAPSHOT_KEY);
  const unchanged = existing?.customMetadata?.contentHash === snapshot.contentHash
    && Number(existing?.customMetadata?.rowCount) === snapshot.items.length;
  if (!unchanged) {
    await bucket.put(SNAPSHOT_KEY, JSON.stringify(snapshot), {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'private, max-age=300'
      },
      customMetadata: {
        contentHash: snapshot.contentHash,
        rowCount: String(snapshot.items.length),
        generatedAt: snapshot.generatedAt
      }
    });
  }
  SNAPSHOT_CACHES.set(bucket, {
    snapshot,
    expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS
  });
  await emitSnapshotEvent(env, snapshot, !unchanged);
  return { written: !unchanged, rowCount: snapshot.items.length };
}

export function invalidateFeedSnapshotCache(db) {
  const bucket = runtimeEnvForDb(db)?.DATA_BUCKET;
  if (bucket) SNAPSHOT_CACHES.delete(bucket);
}

export { SNAPSHOT_KEY, parsePlaybackCursor };
