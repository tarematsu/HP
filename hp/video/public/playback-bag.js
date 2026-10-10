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

// Freshly opened sessions prefer videos not played recently. Once all
// candidates were seen, the oldest played video goes first.
export function postponeRecentlyPlayed(items, recentIds = []) {
  if (!Array.isArray(recentIds) || !recentIds.length) return [...(items || [])];
  const ageById = new Map(recentIds.map((id, index) => [itemId(id), index]));
  const unseen = [];
  const seen = [];
  for (const item of items || []) {
    const age = ageById.get(itemId(item));
    if (age === undefined) unseen.push(item);
    else seen.push({ item, age });
  }
  seen.sort((a, b) => a.age - b.age);
  return [...unseen, ...seen.map(({ item }) => item)];
}

export function createPlaybackBag(items, seed, previousLastPlayedId = null, skipAttempts = 0, recentIds = []) {
  const ordered = postponeRecentlyPlayed(
    preserveServerOrder(items, previousLastPlayedId, skipAttempts),
    recentIds
  );
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
