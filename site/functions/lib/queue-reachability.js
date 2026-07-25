import { bool } from './api-utils.js';

const checkpointRaw = JSON.stringify({ checkpoint: true });
const MINUTE_MS = 60_000;
const MAX_CHECKPOINT_MINUTES = 60;
const reachabilityCache = new WeakMap();

export const QUEUE_REACHABILITY_CHECKPOINT_MS = 60 * MINUTE_MS;

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function checkpointMs(env = {}) {
  const parsed = Math.trunc(Number(env.QUEUE_STABLE_CHECKPOINT_MINUTES));
  const minutes = Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_CHECKPOINT_MINUTES)
    : QUEUE_REACHABILITY_CHECKPOINT_MS / MINUTE_MS;
  return minutes * MINUTE_MS;
}

function cacheFor(db) {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) return null;
  let cache = reachabilityCache.get(db);
  if (!cache) {
    cache = new Map();
    reachabilityCache.set(db, cache);
  }
  return cache;
}

function cacheKey(data) {
  const stationId = numberOrNull(data?.station_id);
  const startTime = numberOrNull(data?.start_time);
  return stationId == null || startTime == null ? null : `${stationId}:${startTime}`;
}

export function markQueueReachability(db, observedAt, data) {
  const key = cacheKey(data);
  const observed = numberOrNull(observedAt);
  const cache = cacheFor(db);
  if (!cache || !key || observed == null) return false;
  cache.set(key, { observed_at: observed, is_paused: bool(data?.is_paused) });
  return true;
}

function cachedCheckpointStillFresh(db, observedAt, data, env) {
  const key = cacheKey(data);
  const observed = numberOrNull(observedAt);
  const cache = cacheFor(db);
  if (!cache || !key || observed == null) return false;
  const previous = cache.get(key);
  if (!previous || previous.is_paused !== bool(data?.is_paused)) return false;
  const previousAt = Number(previous.observed_at);
  return observed >= previousAt && observed - previousAt < checkpointMs(env);
}

export function queueReachabilityStatement(db, observedAt, data, env = {}) {
  const stationId = numberOrNull(data?.station_id);
  const queueId = numberOrNull(data?.queue_id);
  const startTime = numberOrNull(data?.start_time);
  const paused = bool(data?.is_paused);
  const observed = numberOrNull(observedAt);
  const interval = checkpointMs(env);
  return db.prepare(`INSERT INTO sh_queue_snapshots (
      observed_at,station_id,queue_id,start_time,is_paused,raw_json
    )
    SELECT ?,?,?,?,?,?
    WHERE ? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM sh_queue_snapshots latest
        WHERE latest.id=(
          SELECT prior.id
          FROM sh_queue_snapshots prior
          WHERE prior.station_id IS ? AND prior.start_time IS ?
            AND prior.observed_at<=?
          ORDER BY prior.observed_at DESC,prior.id DESC
          LIMIT 1
        )
          AND latest.observed_at>?
          AND COALESCE(latest.is_paused,0)=COALESCE(?,0)
      )`).bind(
    observed, stationId, queueId, startTime, paused, checkpointRaw,
    observed, stationId, startTime,
    stationId, startTime,
    observed,
    observed == null ? null : observed - interval,
    paused,
  );
}

export async function saveQueueReachability(db, observedAt, data, env = {}) {
  if (cachedCheckpointStillFresh(db, observedAt, data, env)) {
    return { inserted: false, skipped: true, reason: 'checkpoint-cache-hit' };
  }
  const result = await queueReachabilityStatement(db, observedAt, data, env).run();
  markQueueReachability(db, observedAt, data);
  return { inserted: Number(result?.meta?.changes || 0) > 0, skipped: false };
}

export function resetQueueReachabilityCacheForTests(db) {
  if (db && reachabilityCache.has(db)) reachabilityCache.delete(db);
}
