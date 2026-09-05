import {
  encodePlaybackCursor,
  parsePlaybackCursor
} from './playback-cursor.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const UINT32_RANGE = 4_294_967_296;
const MAX_CURSOR_KEY = 2_147_483_646;

export const FRESHNESS_WEIGHTS = Object.freeze([
  { maxAgeDays: 7, weight: 5 },
  { maxAgeDays: 30, weight: 3 },
  { maxAgeDays: 90, weight: 2 },
  { maxAgeDays: 180, weight: 1 }
]);

function mix32(value) {
  let mixed = Number(value) >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function stableReferenceMs(nowMs = Date.now()) {
  const value = Number(nowMs);
  if (!Number.isFinite(value)) return Math.floor(Date.now() / DAY_MS) * DAY_MS;
  return Math.floor(value / DAY_MS) * DAY_MS;
}

export function freshnessWeight(firstSeenAt, nowMs = Date.now()) {
  const firstSeenMs = Date.parse(String(firstSeenAt || ''));
  if (!Number.isFinite(firstSeenMs)) return 1;
  const ageDays = Math.max(0, stableReferenceMs(nowMs) - firstSeenMs) / DAY_MS;
  for (const bucket of FRESHNESS_WEIGHTS) {
    if (ageDays <= bucket.maxAgeDays) return bucket.weight;
  }
  return 0.5;
}

export function seededPlaybackUnit(videoId, seed) {
  const id = Number(videoId) >>> 0;
  const seedValue = Number(seed) >>> 0;
  const seedMix = Math.imul(seedValue ^ 0x9e3779b9, 0x85ebca6b);
  const mixed = mix32((id + seedMix) >>> 0);
  return (mixed + 1) / (UINT32_RANGE + 1);
}

export function weightedPlaybackKey(videoId, firstSeenAt, seed, nowMs = Date.now()) {
  const unit = seededPlaybackUnit(videoId, seed);
  const weight = freshnessWeight(firstSeenAt, nowMs);
  const weightedPriority = Math.pow(unit, 1 / weight);
  return Math.min(
    MAX_CURSOR_KEY,
    Math.max(0, Math.floor((1 - weightedPriority) * MAX_CURSOR_KEY))
  );
}

function rowAfterCursor(row, cursor) {
  if (!cursor) return true;
  return row.shuffleKey > cursor.shuffleKey
    || (row.shuffleKey === cursor.shuffleKey && Number(row.id) > cursor.videoId);
}

export function buildWeightedPlaybackPage(rows, options = {}) {
  const limit = Math.max(0, Number(options.limit) || 0);
  if (!limit) return { rows: [], nextCursor: null };

  const cursor = parsePlaybackCursor(options.cursor);
  const referenceMs = stableReferenceMs(options.nowMs);
  const ordered = (rows || [])
    .map((row) => ({
      ...row,
      id: Number(row.id),
      shuffleKey: weightedPlaybackKey(row.id, row.firstSeenAt, options.seed, referenceMs)
    }))
    .sort((left, right) => left.shuffleKey - right.shuffleKey || left.id - right.id)
    .filter((row) => rowAfterCursor(row, cursor));

  const pageRows = ordered.slice(0, limit);
  const hasMore = ordered.length > limit;
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    nextCursor: hasMore && last ? encodePlaybackCursor(0, last) : null
  };
}
