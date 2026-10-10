export const PLAYBACK_BAG_VERSION = 1;
export const RECENT_PLAYBACK_HISTORY_LIMIT = 30;
const RECENT_PLAYBACK_DEFER_WINDOW = 60;

function itemId(value) {
  const id = value?.id ?? value;
  if (id === null || id === undefined) return null;
  const normalized = String(id).trim();
  return normalized ? normalized : null;
}

export function parseRecentPlaybackIds(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const rawId of value) {
    const id = itemId(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= RECENT_PLAYBACK_HISTORY_LIMIT) break;
  }
  return result;
}

export function rememberRecentPlaybackId(raw, video) {
  const id = itemId(video);
  const previous = parseRecentPlaybackIds(raw);
  return id
    ? [id, ...previous.filter((previousId) => previousId !== id)]
      .slice(0, RECENT_PLAYBACK_HISTORY_LIMIT)
    : previous;
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

function preserveServerOrder(items, previousLastPlayedId, skipAttempts) {
  const ordered = [...(items || [])];
  if (previousLastPlayedId === null || previousLastPlayedId === undefined || ordered.length <= 1) {
    return ordered;
  }

  const previousIndex = ordered.findIndex(
    (item) => String(item?.id) === String(previousLastPlayedId)
  );
  if (previousIndex < 0) return ordered;

  const [previousItem] = ordered.splice(previousIndex, 1);
  const insertionIndex = Math.min(
    Math.max(1, Math.trunc(Number(skipAttempts) || 0)),
    ordered.length
  );
  ordered.splice(insertionIndex, 0, previousItem);
  return ordered;
}

export function createPlaybackBag(items, seed, previousLastPlayedId = null, skipAttempts = 0, recentPlayedIds = []) {
  const weightedOrder = preserveServerOrder(items, previousLastPlayedId, skipAttempts);
  const recent = new Set(parseRecentPlaybackIds(recentPlayedIds));
  const windowSize = Math.min(weightedOrder.length, RECENT_PLAYBACK_DEFER_WINDOW);
  const windowItems = weightedOrder.slice(0, windowSize);
  // Avoid replaying recently seen items at the start of a fresh round while
  // leaving the server's weighted order intact outside a bounded window.
  const ordered = recent.size
    ? [
        ...windowItems.filter((item) => !recent.has(itemId(item))),
        ...windowItems.filter((item) => recent.has(itemId(item))),
        ...weightedOrder.slice(windowSize)
      ]
    : weightedOrder;
  return {
    version: PLAYBACK_BAG_VERSION,
    seed: Number(seed),
    remainingIds: ordered.map(itemId).filter(Boolean),
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
