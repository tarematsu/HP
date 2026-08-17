import { shuffleFeedItems } from './feed-shuffle.js';

export const PLAYBACK_BAG_VERSION = 1;

function itemId(value) {
  const id = value?.id ?? value;
  if (id === null || id === undefined) return null;
  const normalized = String(id).trim();
  return normalized ? normalized : null;
}

export function parsePlaybackBag(raw) {
  if (!raw) return null;
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Number(value.version) !== PLAYBACK_BAG_VERSION) return null;
  const seed = Number(value.seed);
  if (!Number.isInteger(seed) || seed <= 0) return null;
  if (!Array.isArray(value.remainingIds)) return null;

  const remainingIds = [];
  const seen = new Set();
  for (const rawId of value.remainingIds) {
    const id = itemId(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    remainingIds.push(id);
  }

  return {
    version: PLAYBACK_BAG_VERSION,
    seed,
    remainingIds,
    lastPlayedId: itemId(value.lastPlayedId)
  };
}

export function createPlaybackBag(items, seed, previousLastPlayedId = null, skipAttempts = 0) {
  const shuffled = shuffleFeedItems(items, seed, previousLastPlayedId, skipAttempts);
  return {
    version: PLAYBACK_BAG_VERSION,
    seed: Number(seed),
    remainingIds: shuffled.map(itemId).filter(Boolean),
    lastPlayedId: itemId(previousLastPlayedId)
  };
}

export function restorePlaybackBagItems(items, bag) {
  const parsed = parsePlaybackBag(bag);
  if (!parsed) return [];
  const byId = new Map();
  for (const item of items || []) {
    const id = itemId(item);
    if (id && !byId.has(id)) byId.set(id, item);
  }
  const restored = [];
  for (const id of parsed.remainingIds) {
    const item = byId.get(id);
    if (item) restored.push(item);
  }
  return restored;
}

export function playbackBagAfterIndex(items, index, seed) {
  const normalizedIndex = Math.max(-1, Math.trunc(Number(index) || 0));
  const current = items?.[normalizedIndex] || null;
  return {
    version: PLAYBACK_BAG_VERSION,
    seed: Number(seed),
    remainingIds: (items || []).slice(normalizedIndex + 1).map(itemId).filter(Boolean),
    lastPlayedId: itemId(current)
  };
}
